<?php

namespace App\Services;

use App\Models\ModelAssignment;
use App\Models\PermissionPolicy;
use App\Models\Plan;
use App\Models\User;
use App\Models\UserPlan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class PlanService
{
    /**
     * Grant a plan to a user.
     * Returns the created UserPlan (null if plan is archived/inactive).
     *
     * @param array $options [
     *   'source'   => 'purchase|redeem|admin|register',
     *   'operator' => int|null,
     *   'remark'   => string,
     * ]
     */
    public function grant(User $user, Plan $plan, array $options = []): ?UserPlan
    {
        if ($plan->status !== 'active') {
            Log::warning("[plan] grant skipped: plan #{$plan->id} status={$plan->status}");
            return null;
        }

        $source     = (string)($options['source'] ?? 'admin');
        $operatorId = $options['operator'] ?? null;
        $remark     = (string)($options['remark'] ?? '');

        return $this->grantFromSnapshot($user, $this->snapshot($plan), [
            'source' => $source,
            'operator' => $operatorId,
            'remark' => $remark,
            // 默认跟随套餐自身的续充周期（后台发放/批量发放/兑换码/注册赠送均走此处），
            // 调用方仍可通过 options 显式覆盖；不能写死 'none' 否则月度套餐会被降级成一次性。
            'quota_refill_cycle' => $options['quota_refill_cycle'] ?? $plan->quota_refill_cycle ?? 'none',
            'upgraded_from_user_plan_id' => $options['upgraded_from_user_plan_id'] ?? null,
        ]);
    }

    /**
     * Grant a plan from a snapshot (typically captured at order creation time).
     * 与 grant() 不同点：完全按快照值发放，不读取当前 plan 的最新字段。
     * 用于支付场景，防止订单 pending 期间 plan 被修改导致发放与购买内容不一致。
     *
     * 快照结构示例：
     * [
     *   'plan_id'       => 5,
     *   'code'          => 'vip-1m',
     *   'name'          => 'VIP 月卡',
     *   'duration_days' => 30,
     *   'token_quota'   => 1000.0,
     *   'credit_quota'  => 0.0,
     *   'model_ids'     => [12, 15],
     *   'policies'      => ['allow_image_gen' => true, 'max_context_messages' => 100],
     * ]
     *
     * @param array $options [
     *   'source'   => 'purchase|redeem|admin|register',
     *   'operator' => int|null,
     *   'remark'   => string,
     * ]
     */
    public function grantFromSnapshot(User $user, array $snapshot, array $options = []): UserPlan
    {
        $planId        = (int)($snapshot['plan_id'] ?? 0);
        $durationDays  = (int)($snapshot['duration_days'] ?? 0);
        $tokenQuota    = (float)($snapshot['token_quota'] ?? 0);
        $creditQuota   = (float)($snapshot['credit_quota'] ?? 0);
        $storageQuota  = (int)($snapshot['storage_quota_bytes'] ?? 0);
        $modelIds      = is_array($snapshot['model_ids'] ?? null) ? array_values(array_unique(array_map('intval', $snapshot['model_ids']))) : [];
        $policies      = is_array($snapshot['policies'] ?? null) ? $snapshot['policies'] : [];

        if ($planId <= 0) {
            throw new \InvalidArgumentException('快照中缺少 plan_id');
        }

        $source     = (string)($options['source'] ?? 'purchase');
        $operatorId = $options['operator'] ?? null;
        $remark     = (string)($options['remark'] ?? '');
        $quotaRefillCycle = (string)($options['quota_refill_cycle'] ?? ($snapshot['quota_refill_cycle'] ?? 'none'));
        $upgradedFromUserPlanId = $options['upgraded_from_user_plan_id'] ?? null;

        return DB::transaction(function () use (
            $user, $planId, $durationDays, $tokenQuota, $creditQuota, $storageQuota,
            $modelIds, $policies, $source, $operatorId, $remark, $snapshot,
            $quotaRefillCycle, $upgradedFromUserPlanId
        ) {
            $now       = now();
            $expiresAt = $durationDays > 0 ? $now->copy()->addDays($durationDays) : null;
            $quotaRefillCycle = in_array($quotaRefillCycle, ['monthly'], true) ? $quotaRefillCycle : 'none';
            $nextQuotaRefillAt = $quotaRefillCycle === 'monthly' ? $now->copy()->addMonthNoOverflow() : null;
            $initialQuotaExpiresAt = $this->quotaBucketExpiresAt($now, $expiresAt, $quotaRefillCycle);

            // Create UserPlan record
            $userPlan = UserPlan::create([
                'user_id'        => $user->id,
                'plan_id'        => $planId,
                'source'         => $source,
                'activated_at'   => $now,
                'expires_at'     => $expiresAt,
                'quota_refill_cycle' => $quotaRefillCycle,
                'last_quota_refilled_at' => $now,
                'next_quota_refill_at' => $nextQuotaRefillAt,
                'status'         => 'active',
                'token_granted'  => $tokenQuota,
                'credit_granted' => $creditQuota,
                'storage_granted' => $storageQuota,
                'policy_snapshot_json' => $snapshot,
                'remark'         => $remark,
                'operator_id'    => $operatorId,
                'upgraded_from_user_plan_id' => $upgradedFromUserPlanId,
            ]);

            $logRemark = sprintf('[套餐发放] 套餐=%s(#%d) 持有=#%d 来源=%s', (string)($snapshot['code'] ?? ''), $planId, $userPlan->id, $this->sourceLabel($source));
            if ($tokenQuota > 0) {
                app(BalanceService::class)->grantPlanQuota($userPlan, 'token', $tokenQuota, $logRemark, $operatorId, $initialQuotaExpiresAt);
            }
            if ($creditQuota > 0) {
                app(BalanceService::class)->grantPlanQuota($userPlan, 'credit', $creditQuota, $logRemark, $operatorId, $initialQuotaExpiresAt);
            }

            // Grant model assignments per snapshot.model_ids（idempotent per plan）
            foreach ($modelIds as $cloudModelId) {
                ModelAssignment::firstOrCreate([
                    'cloud_model_id' => $cloudModelId,
                    'assignee_type'  => 'user',
                    'assignee_id'    => $user->id,
                    'source_plan_id' => $planId,
                ]);
            }

            // Grant permission policies per snapshot.policies
            foreach ($policies as $policyKey => $policyValue) {
                if (!is_string($policyKey) || $policyKey === '') continue;
                PermissionPolicy::updateOrCreate(
                    [
                        'target_type'    => 'user',
                        'target_id'      => $user->id,
                        'policy_key'     => $policyKey,
                        'source_plan_id' => $planId,
                    ],
                    [
                        'policy_value' => is_string($policyValue) ? $policyValue : json_encode($policyValue, JSON_UNESCAPED_UNICODE),
                    ]
                );
            }

            if (isset($snapshot['rate_limit']) && is_array($snapshot['rate_limit']) && !empty($snapshot['rate_limit'])) {
                PermissionPolicy::updateOrCreate(
                    [
                        'target_type'    => 'user',
                        'target_id'      => $user->id,
                        'policy_key'     => 'rate_limit',
                        'source_plan_id' => $planId,
                    ],
                    [
                        'policy_value' => json_encode($snapshot['rate_limit'], JSON_UNESCAPED_UNICODE),
                    ]
                );
            }

            return $userPlan->fresh();
        });
    }

    /**
     * Expire a user plan: cleanup plan-sourced resources, mark status.
     * Other active UserPlan rows referencing the same plan_id keep resources intact.
     */
    public function expire(UserPlan $userPlan, string $newStatus = 'expired'): UserPlan
    {
        return DB::transaction(function () use ($userPlan, $newStatus) {
            // If there are other active UserPlans for same (user,plan), keep the shared resources.
            $otherActive = UserPlan::where('user_id', $userPlan->user_id)
                ->where('plan_id', $userPlan->plan_id)
                ->where('id', '<>', $userPlan->id)
                ->where('status', 'active')
                ->exists();

            if (!$otherActive) {
                ModelAssignment::where('assignee_type', 'user')
                    ->where('assignee_id', $userPlan->user_id)
                    ->where('source_plan_id', $userPlan->plan_id)
                    ->delete();

                PermissionPolicy::where('target_type', 'user')
                    ->where('target_id', $userPlan->user_id)
                    ->where('source_plan_id', $userPlan->plan_id)
                    ->delete();
            }

            $userPlan->status = $newStatus;
            $userPlan->save();

            app(BalanceService::class)->expirePlanQuotas($userPlan, $newStatus);

            return $userPlan;
        });
    }

    /**
     * Revoke a user plan (admin force-expire).
     */
    public function revoke(UserPlan $userPlan): UserPlan
    {
        return $this->expire($userPlan, 'revoked');
    }

    /**
     * Find active UserPlans that have already passed expires_at.
     */
    public function findExpirable(int $limit = 500)
    {
        return UserPlan::where('status', 'active')
            ->whereNotNull('expires_at')
            ->where('expires_at', '<', now())
            ->limit($limit)
            ->get();
    }

    public function findDueMonthlyRefills(int $limit = 500)
    {
        return UserPlan::with('user')
            ->where('status', 'active')
            ->where('quota_refill_cycle', 'monthly')
            ->whereNotNull('next_quota_refill_at')
            ->where('next_quota_refill_at', '<=', now())
            ->where(function ($q) {
                $q->whereNull('expires_at')->orWhere('expires_at', '>', now());
            })
            ->orderBy('next_quota_refill_at')
            ->limit($limit)
            ->get();
    }

    public function refillMonthlyQuota(UserPlan $userPlan): ?UserPlan
    {
        return DB::transaction(function () use ($userPlan) {
            $locked = UserPlan::lockForUpdate()->find($userPlan->id);
            if (!$locked || !$locked->isActive() || $locked->quota_refill_cycle !== 'monthly') {
                return null;
            }
            if (!$locked->next_quota_refill_at || $locked->next_quota_refill_at->gt(now())) {
                return $locked;
            }

            $now = now();
            $quotaExpiresAt = $this->quotaBucketExpiresAt($now, $locked->expires_at, 'monthly');
            $remark = sprintf('[套餐续充] 套餐=#%d 持有=#%d', $locked->plan_id, $locked->id);

            if ((float)$locked->token_granted > 0) {
                app(BalanceService::class)->grantPlanQuota($locked, 'token', (float)$locked->token_granted, $remark, null, $quotaExpiresAt);
            }
            if ((float)$locked->credit_granted > 0) {
                app(BalanceService::class)->grantPlanQuota($locked, 'credit', (float)$locked->credit_granted, $remark, null, $quotaExpiresAt);
            }

            $next = $now->copy()->addMonthNoOverflow();
            $locked->last_quota_refilled_at = $now;
            $locked->next_quota_refill_at = ($locked->expires_at && $next->gte($locked->expires_at)) ? null : $next;
            $locked->save();

            return $locked->fresh();
        });
    }

    public function upgradeFromSnapshot(User $user, UserPlan $fromUserPlan, array $snapshot, array $options = []): UserPlan
    {
        return DB::transaction(function () use ($user, $fromUserPlan, $snapshot, $options) {
            $locked = UserPlan::lockForUpdate()->find($fromUserPlan->id);
            if (!$locked || (int)$locked->user_id !== (int)$user->id) {
                throw new \InvalidArgumentException('原套餐不存在');
            }
            if (!$locked->isActive()) {
                throw new \InvalidArgumentException('原套餐已失效，无法升级');
            }

            $newPlan = $this->grantFromSnapshot($user, $snapshot, array_merge($options, [
                'source' => 'upgrade',
                'upgraded_from_user_plan_id' => $locked->id,
            ]));
            $this->expire($locked, 'revoked');

            return $newPlan;
        });
    }

    public function renewFromSnapshot(User $user, UserPlan $userPlan, array $snapshot, array $options = []): UserPlan
    {
        $planId = (int)($snapshot['plan_id'] ?? 0);
        $durationDays = (int)($snapshot['duration_days'] ?? 0);
        $tokenQuota = (float)($snapshot['token_quota'] ?? 0);
        $creditQuota = (float)($snapshot['credit_quota'] ?? 0);
        $storageQuota = (int)($snapshot['storage_quota_bytes'] ?? 0);
        $operatorId = $options['operator'] ?? null;
        $remark = (string)($options['remark'] ?? '');
        $quotaRefillCycle = (string)($options['quota_refill_cycle'] ?? ($snapshot['quota_refill_cycle'] ?? $userPlan->quota_refill_cycle ?? 'none'));

        return DB::transaction(function () use (
            $user, $userPlan, $snapshot, $planId, $durationDays, $tokenQuota,
            $creditQuota, $storageQuota, $operatorId, $remark, $quotaRefillCycle
        ) {
            $locked = UserPlan::lockForUpdate()->find($userPlan->id);
            if (!$locked || (int)$locked->user_id !== (int)$user->id) {
                throw new \InvalidArgumentException('原套餐不存在');
            }
            if (!$locked->isActive()) {
                throw new \InvalidArgumentException('原套餐已失效，无法续费');
            }
            if ($planId <= 0 || (int)$locked->plan_id !== $planId) {
                throw new \InvalidArgumentException('续费套餐不匹配');
            }

            $now = now();
            $baseExpiresAt = $locked->expires_at && $locked->expires_at->gt($now) ? $locked->expires_at->copy() : $now->copy();
            $newExpiresAt = $durationDays > 0 ? $baseExpiresAt->copy()->addDays($durationDays) : null;
            $quotaRefillCycle = in_array($quotaRefillCycle, ['monthly'], true) ? $quotaRefillCycle : 'none';
            $quotaExpiresAt = $this->quotaBucketExpiresAt($now, $newExpiresAt, $quotaRefillCycle);

            $locked->expires_at = $newExpiresAt;
            $locked->quota_refill_cycle = $quotaRefillCycle;
            $locked->last_quota_refilled_at = $locked->last_quota_refilled_at ?: $now;
            if ($quotaRefillCycle === 'monthly' && (!$locked->next_quota_refill_at || $locked->next_quota_refill_at->lte($now))) {
                $next = $now->copy()->addMonthNoOverflow();
                $locked->next_quota_refill_at = ($newExpiresAt && $next->gte($newExpiresAt)) ? null : $next;
            } elseif ($quotaRefillCycle !== 'monthly') {
                $locked->next_quota_refill_at = null;
            }
            if ($quotaRefillCycle === 'monthly') {
                $locked->token_granted = $tokenQuota;
                $locked->credit_granted = $creditQuota;
            } else {
                $locked->token_granted = (float)$locked->token_granted + $tokenQuota;
                $locked->credit_granted = (float)$locked->credit_granted + $creditQuota;
            }
            // 容量为套餐固定额度，续费不累加（同一套餐容量不变）
            $locked->storage_granted = $storageQuota;
            $locked->policy_snapshot_json = $snapshot;
            $locked->remark = $remark ?: $locked->remark;
            $locked->save();

            $logRemark = sprintf('[套餐续费] 套餐=%s(#%d) 持有=#%d', (string)($snapshot['code'] ?? ''), $planId, $locked->id);
            if ($tokenQuota > 0) {
                app(BalanceService::class)->grantPlanQuota($locked, 'token', $tokenQuota, $logRemark, $operatorId, $quotaExpiresAt);
            }
            if ($creditQuota > 0) {
                app(BalanceService::class)->grantPlanQuota($locked, 'credit', $creditQuota, $logRemark, $operatorId, $quotaExpiresAt);
            }

            return $locked->fresh();
        });
    }

    /**
     * 把套餐发放来源枚举转成面向用户的中文标签。
     * 数据库 `user_plans.source` 字段仍保持英文枚举（业务逻辑分支匹配），
     * 仅在写入余额流水 remark 等用户可见文案时调用此映射。
     */
    private function sourceLabel(string $source): string
    {
        return match ($source) {
            'purchase' => '购买',
            'redeem'   => '兑换码',
            'admin'    => '后台发放',
            'register' => '注册赠送',
            'upgrade'  => '升级',
            default    => $source,
        };
    }

    private function quotaBucketExpiresAt($startedAt, $planExpiresAt, string $cycle)
    {
        if ($cycle !== 'monthly') {
            return $planExpiresAt;
        }

        $bucketExpiresAt = $startedAt->copy()->addMonthNoOverflow();
        if ($planExpiresAt && $planExpiresAt->lt($bucketExpiresAt)) {
            return $planExpiresAt;
        }

        return $bucketExpiresAt;
    }

    private function snapshot(Plan $plan): array
    {
        $plan->loadMissing('modelAssignments', 'permissions');

        $policies = [];
        foreach ($plan->permissions as $permission) {
            $value = json_decode((string)$permission->policy_value, true);
            $policies[$permission->policy_key] = $value !== null ? $value : $permission->policy_value;
        }

        return [
            'plan_id' => $plan->id,
            'code' => $plan->code,
            'name' => $plan->name,
            'description' => $plan->description,
            'duration_days' => (int)$plan->duration_days,
            'token_quota' => (float)$plan->token_quota,
            'credit_quota' => (float)$plan->credit_quota,
            'storage_quota_bytes' => (int)($plan->storage_quota_bytes ?? 0),
            'quota_refill_cycle' => (string)($plan->quota_refill_cycle ?? 'none'),
            'rate_limit' => is_array($plan->rate_limit_json) ? $plan->rate_limit_json : [],
            'model_ids' => $plan->modelAssignments->pluck('cloud_model_id')->map(fn($id) => (int)$id)->unique()->values()->all(),
            'policies' => $policies,
        ];
    }
}
