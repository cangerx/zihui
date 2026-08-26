<?php

namespace App\Services;

use App\Models\BalanceLog;
use App\Models\User;
use App\Models\UserBalance;
use App\Models\UserPlan;
use App\Models\UserPlanQuota;
use Illuminate\Support\Facades\DB;

class BalanceService
{
    public function totalBalance(int $userId, string $type): float
    {
        $wallet = (float)(UserBalance::where('user_id', $userId)
            ->where('balance_type', $type)
            ->value('amount') ?? 0);

        $plan = UserPlanQuota::where('user_id', $userId)
            ->where('balance_type', $type)
            ->where('status', 'active')
            ->where(function ($q) {
                $q->whereNull('expires_at')->orWhere('expires_at', '>', now());
            })
            ->get()
            ->sum(fn($q) => max(0, (float)$q->granted - (float)$q->consumed));

        return $wallet + (float)$plan;
    }

    public function walletBalance(int $userId, string $type): float
    {
        return (float)(UserBalance::where('user_id', $userId)
            ->where('balance_type', $type)
            ->value('amount') ?? 0);
    }

    public function addWallet(int $userId, string $type, float $amount, string $changeType, string $remark = '', ?int $operatorId = null, string $requestId = ''): float
    {
        if ($amount == 0.0) return $this->walletBalance($userId, $type);

        return DB::transaction(function () use ($userId, $type, $amount, $changeType, $remark, $operatorId, $requestId) {
            $balance = $this->walletRowForUpdate($userId, $type);
            $balance->setAttribute('amount', (float)$balance->amount + $amount);
            $balance->save();

            BalanceLog::create([
                'user_id' => $userId,
                'balance_type' => $type,
                'change_amount' => $amount,
                'balance_after' => $this->totalBalance($userId, $type),
                'change_type' => $changeType,
                'remark' => $remark,
                'operator_id' => $operatorId,
                'source_plan_id' => null,
                'request_id' => $requestId,
            ]);

            return (float)$balance->amount;
        });
    }

    public function grantPlanQuota(UserPlan $userPlan, string $type, float $amount, string $remark = '', ?int $operatorId = null, $expiresAt = null): ?UserPlanQuota
    {
        if ($amount <= 0) return null;

        $quota = UserPlanQuota::create([
            'user_id' => $userPlan->user_id,
            'user_plan_id' => $userPlan->id,
            'plan_id' => $userPlan->plan_id,
            'balance_type' => $type,
            'granted' => (string)$amount,
            'consumed' => '0',
            'expires_at' => $expiresAt ?: $userPlan->expires_at,
            'status' => $userPlan->status,
        ]);

        BalanceLog::create([
            'user_id' => $userPlan->user_id,
            'balance_type' => $type,
            'change_amount' => $amount,
            'balance_after' => $this->totalBalance((int)$userPlan->user_id, $type),
            'change_type' => 'plan_grant',
            'remark' => $remark,
            'operator_id' => $operatorId,
            'source_plan_id' => $userPlan->id,
            'request_id' => '',
        ]);

        return $quota;
    }

    /**
     * 管理端人工调整套餐余量：向指定 user_plan 追加一个 adjust 桶（granted=amount，
     * 到期时间跟随该套餐），与套餐发放共用桶模型与扣费排序——用户「套餐余量」即时可见变化。
     *
     * 不直接改已有桶的 granted：月度套餐的 refill 按 user_plans 快照重发，
     * 直接改桶会污染下次续充的基线；adjust 桶是独立增量，语义干净。
     * amount 必须 > 0（「计入套餐余量」只有追加语义；扣减请走钱包负数充值）。
     */
    public function adjustPlanQuota(UserPlan $userPlan, string $type, float $amount, string $remark = '', ?int $operatorId = null): UserPlanQuota
    {
        $quota = UserPlanQuota::create([
            'user_id' => $userPlan->user_id,
            'user_plan_id' => $userPlan->id,
            'plan_id' => $userPlan->plan_id,
            'balance_type' => $type,
            'granted' => (string)$amount,
            'consumed' => '0',
            'expires_at' => $userPlan->expires_at,
            'status' => 'active',
        ]);

        BalanceLog::create([
            'user_id' => $userPlan->user_id,
            'balance_type' => $type,
            'change_amount' => $amount,
            'balance_after' => $this->totalBalance((int)$userPlan->user_id, $type),
            'change_type' => 'plan_adjust',
            'remark' => $remark,
            'operator_id' => $operatorId,
            'source_plan_id' => $userPlan->id,
            'request_id' => '',
        ]);

        return $quota;
    }

    public function expirePlanQuotas(UserPlan $userPlan, string $status): void
    {
        UserPlanQuota::where('user_plan_id', $userPlan->id)->update(['status' => $status]);
    }

    public function deduct(User $user, string $type, float $amount, string $changeType = 'usage', string $remark = '', string $requestId = ''): array
    {
        if ($amount <= 0) {
            return ['deducted' => 0.0, 'source_plan_id' => null, 'balance_after' => $this->totalBalance($user->id, $type), 'items' => []];
        }

        return DB::transaction(function () use ($user, $type, $amount, $changeType, $remark, $requestId) {
            $remaining = $amount;
            $items = [];
            $sourcePlanId = null;

            $quotas = UserPlanQuota::lockForUpdate()
                ->where('user_id', $user->id)
                ->where('balance_type', $type)
                ->where('status', 'active')
                ->where(function ($q) {
                    $q->whereNull('expires_at')->orWhere('expires_at', '>', now());
                })
                ->orderByRaw('expires_at IS NULL ASC')
                ->orderBy('expires_at')
                ->orderBy('id')
                ->get();

            foreach ($quotas as $quota) {
                if ($remaining <= 0) break;
                $available = max(0, (float)$quota->granted - (float)$quota->consumed);
                if ($available <= 0) continue;
                $take = min($available, $remaining);
                $quota->setAttribute('consumed', (float)$quota->consumed + $take);
                $quota->save();
                $remaining -= $take;
                if ($sourcePlanId === null) $sourcePlanId = (int)$quota->user_plan_id;
                $items[] = ['source' => 'plan', 'source_plan_id' => (int)$quota->user_plan_id, 'amount' => $take];
            }

            if ($remaining > 0) {
                $wallet = $this->walletRowForUpdate($user->id, $type);
                $walletAvailable = (float)$wallet->amount;
                if ($walletAvailable + 0.0000001 < $remaining) {
                    throw new \RuntimeException($type === 'credit' ? 'Insufficient credit balance' : 'Insufficient token balance');
                }
                $take = $remaining;
                $wallet->setAttribute('amount', max(0, $walletAvailable - $take));
                $wallet->save();
                $remaining = 0;
                $items[] = ['source' => 'wallet', 'source_plan_id' => null, 'amount' => $take];
            }

            $balanceAfter = $this->totalBalance($user->id, $type);
            foreach ($items as $item) {
                BalanceLog::create([
                    'user_id' => $user->id,
                    'balance_type' => $type,
                    'change_amount' => -1 * (float)$item['amount'],
                    'balance_after' => $balanceAfter,
                    'change_type' => $changeType,
                    'remark' => $remark,
                    'operator_id' => null,
                    'source_plan_id' => $item['source_plan_id'],
                    'request_id' => $requestId,
                ]);
            }

            return ['deducted' => $amount, 'source_plan_id' => $sourcePlanId, 'balance_after' => $balanceAfter, 'items' => $items];
        });
    }

    private function walletRowForUpdate(int $userId, string $type): UserBalance
    {
        $balance = UserBalance::lockForUpdate()
            ->where('user_id', $userId)
            ->where('balance_type', $type)
            ->first();

        if (!$balance) {
            $balance = UserBalance::create([
                'user_id' => $userId,
                'balance_type' => $type,
                'amount' => 0,
            ]);
            $balance = UserBalance::lockForUpdate()->find($balance->id);
        }

        return $balance;
    }
}
