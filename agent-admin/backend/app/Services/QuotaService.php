<?php

namespace App\Services;

use App\Models\PermissionPolicy;
use App\Models\UsageCounter;
use App\Models\User;
use App\Models\UserPlan;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

class QuotaService
{
    public const COUNTERS = [
        'chat_quota_per_day' => 'day',
        'chat_quota_per_month' => 'month',
        'image_quota_per_day' => 'day',
        'image_quota_per_month' => 'month',
        'embed_chars_per_day' => 'day',
        'embed_chars_per_month' => 'month',
        'matting_quota_per_day' => 'day',
        'matting_quota_per_month' => 'month',
        'fine_matting_quota_per_day' => 'day',
        'fine_matting_quota_per_month' => 'month',
        'video_quota_per_day' => 'day',
        'video_quota_per_month' => 'month',
    ];

    public function policies(User $user): array
    {
        return array_map(fn(array $entry) => $entry['value'], $this->policyResolution($user));
    }

    /**
     * 返回生效策略及其最终来源，与 policies() 共用同一合并路径。
     *
     * @return array<string, array{value:mixed, source:string}>
     */
    public function policyResolution(User $user): array
    {
        $userSelf = PermissionPolicy::where('target_type', 'user')
            ->where('target_id', $user->id)
            ->whereNull('source_plan_id')
            ->pluck('policy_value', 'policy_key')
            ->toArray();

        $activePlanIds = UserPlan::where('user_id', $user->id)
            ->where('status', 'active')
            ->where(function ($q) {
                $q->whereNull('expires_at')->orWhere('expires_at', '>', now());
            })
            ->pluck('plan_id')
            ->unique()
            ->values()
            ->toArray();

        $planRows = collect();
        if (!empty($activePlanIds)) {
            $planRows = PermissionPolicy::where('target_type', 'user')
                ->where('target_id', $user->id)
                ->whereIn('source_plan_id', $activePlanIds)
                ->get(['policy_key', 'policy_value']);
        }

        $groupIds = $user->groups()->pluck('user_groups.id')->toArray();
        $groupPolicies = [];
        if (!empty($groupIds)) {
            $groupPolicies = PermissionPolicy::where('target_type', 'group')
                ->whereIn('target_id', $groupIds)
                ->pluck('policy_value', 'policy_key')
                ->toArray();
        }

        $defaults = [
            'allow_custom_provider' => true,
            'allow_custom_embedding' => true,
            'allow_custom_video_provider' => false,
            'allow_image_gen' => true,
            'allow_ai_video' => false,
            'allow_knowledge_base' => true,
            'max_context_messages' => 50,
            'allow_image_matting' => true,
            'allow_custom_matting_provider' => false,
            'image_matting_quota_per_month' => 100,
            'matting_quota_per_month' => 100,
            'allow_fine_matting' => true,
            'fine_matting_quota_per_month' => 100,
            // 去AI标记：默认关（全部用户不可见/不可用），按用户/分组/套餐白名单开通
            'allow_ai_mark_removal' => false,
            // 微信 ClawBot：默认关（全部用户不可用），按用户/分组/套餐白名单开通。
            // 仅控制「能否使用」；菜单显示不受此权限控制（由「桌面端设置 → 菜单配置」管理，默认显示）。
            'allow_clawbot' => false,
        ];

        // 「店铺商品图」per-user 二级门控：默认关（默认不开放），按商城独立。云控端被授权后，
        // 管理员在「桌面端设置 → 店铺商品图」独立页按用户/分组放开（policy_key=allow_{mall}_shop）。
        // 最终下发给桌面端的值还要 AND 第一级（云控端是否被授权端授权对应商城），见 ClientController。
        // mall_key 单一来源：从 EweiShopAuthorization::MALL_KEYS 动态生成默认项，新增商城无需改此处。
        foreach (\App\Services\CloudBuild\EweiShopAuthorization::MALL_KEYS as $m) {
            $defaults[\App\Services\CloudBuild\EweiShopAuthorization::policyKey($m)] = false;
        }

        $groupValues = $this->decodeMap($groupPolicies);
        $planValues = $this->mergePermissive($planRows);
        $userValues = $this->decodeMap($userSelf);
        $result = array_merge($defaults, $groupValues, $planValues, $userValues);
        $sources = array_fill_keys(array_keys($defaults), 'default');
        foreach (array_keys($groupValues) as $key) $sources[$key] = 'group';
        foreach (array_keys($planValues) as $key) $sources[$key] = 'plan';
        foreach (array_keys($userValues) as $key) $sources[$key] = 'user';

        if (isset($result['matting_quota_per_month']) || isset($result['image_matting_quota_per_month'])) {
            $quota = max((int)($result['matting_quota_per_month'] ?? 0), (int)($result['image_matting_quota_per_month'] ?? 0));
            $result['matting_quota_per_month'] = $quota;
            $result['image_matting_quota_per_month'] = $quota;
        }

        $resolved = [];
        foreach ($result as $key => $value) {
            $resolved[$key] = ['value' => $value, 'source' => $sources[$key] ?? 'default'];
        }
        return $resolved;
    }

    public function limit(User $user, string $counterKey): int
    {
        $policies = $this->policies($user);
        $value = $policies[$counterKey] ?? 0;
        if (is_array($value) && isset($value['limit'])) $value = $value['limit'];
        return max(0, (int)$value);
    }

    public function assertAndConsume(User $user, string $counterKey, int $amount = 1): array
    {
        $amount = max(1, $amount);
        $limit = $this->limit($user, $counterKey);
        $period = $this->period($counterKey);

        if ($limit <= 0) {
            return ['counter_key' => $counterKey, 'limit' => 0, 'used' => 0, 'period' => $period, 'unlimited' => true];
        }

        return DB::transaction(function () use ($user, $counterKey, $period, $limit, $amount) {
            $counter = UsageCounter::lockForUpdate()
                ->where('user_id', $user->id)
                ->where('counter_key', $counterKey)
                ->where('period', $period)
                ->first();

            if (!$counter) {
                $counter = UsageCounter::create([
                    'user_id' => $user->id,
                    'counter_key' => $counterKey,
                    'period' => $period,
                    'used' => 0,
                ]);
                $counter = UsageCounter::lockForUpdate()->find($counter->id);
            }

            $next = (int)$counter->used + $amount;
            if ($next > $limit) {
                throw new \RuntimeException("Quota exceeded: {$counterKey}");
            }

            $counter->used = $next;
            $counter->save();

            return ['counter_key' => $counterKey, 'limit' => $limit, 'used' => $next, 'period' => $period, 'unlimited' => false];
        });
    }

    public function check(User $user, string $counterKey, int $amount = 1): array
    {
        $amount = max(1, $amount);
        $limit = $this->limit($user, $counterKey);
        $period = $this->period($counterKey);
        $used = (int)(UsageCounter::where('user_id', $user->id)
            ->where('counter_key', $counterKey)
            ->where('period', $period)
            ->value('used') ?? 0);

        return [
            'counter_key' => $counterKey,
            'limit' => $limit,
            'used' => $used,
            'remaining' => $limit <= 0 ? null : max(0, $limit - $used),
            'period' => $period,
            'reset_at' => $this->resetAt($counterKey)->toIso8601String(),
            'allowed' => $limit <= 0 || ($used + $amount) <= $limit,
            'unlimited' => $limit <= 0,
        ];
    }

    public function statuses(User $user): array
    {
        $out = [];
        foreach (array_keys(self::COUNTERS) as $key) {
            $status = $this->check($user, $key, 1);
            if ($status['limit'] > 0) $out[] = $status;
        }
        return $out;
    }

    public function consumeForType(User $user, string $type, int $amount = 1): array
    {
        $results = [];
        foreach ($this->keysForType($type) as $key) {
            if ($this->limit($user, $key) > 0) {
                $results[] = $this->assertAndConsume($user, $key, $amount);
            }
        }
        return $results;
    }

    public function assertAvailableForType(User $user, string $type, int $amount = 1): array
    {
        $results = [];
        foreach ($this->keysForType($type) as $key) {
            $status = $this->check($user, $key, $amount);
            $results[] = $status;
            if (!$status['allowed']) {
                throw new \RuntimeException("Quota exceeded: {$key}");
            }
        }
        return $results;
    }

    public function keysForType(string $type): array
    {
        return match ($type) {
            'chat' => ['chat_quota_per_day', 'chat_quota_per_month'],
            'image' => ['image_quota_per_day', 'image_quota_per_month'],
            'embedding' => ['embed_chars_per_day', 'embed_chars_per_month'],
            'matting' => ['matting_quota_per_day', 'matting_quota_per_month'],
            'fine_matting' => ['fine_matting_quota_per_day', 'fine_matting_quota_per_month'],
            'video' => ['video_quota_per_day', 'video_quota_per_month'],
            default => [],
        };
    }

    public function period(string $counterKey): string
    {
        $unit = self::COUNTERS[$counterKey] ?? (str_ends_with($counterKey, '_per_month') ? 'month' : 'day');
        return $unit === 'month' ? now()->format('Y-m') : now()->format('Y-m-d');
    }

    public function resetAt(string $counterKey): Carbon
    {
        $unit = self::COUNTERS[$counterKey] ?? (str_ends_with($counterKey, '_per_month') ? 'month' : 'day');
        return $unit === 'month' ? now()->copy()->startOfMonth()->addMonth() : now()->copy()->startOfDay()->addDay();
    }

    private function decodeMap(array $raw): array
    {
        $out = [];
        foreach ($raw as $key => $value) {
            $decoded = json_decode((string)$value, true);
            $out[$key] = $decoded !== null ? $decoded : $value;
        }
        return $out;
    }

    private function mergePermissive($rows): array
    {
        $out = [];
        foreach ($rows as $row) {
            $key = $row->policy_key;
            $value = json_decode((string)$row->policy_value, true);
            if ($value === null) $value = $row->policy_value;

            if (!array_key_exists($key, $out)) {
                $out[$key] = $value;
                continue;
            }

            $current = $out[$key];
            if (is_bool($current) || is_bool($value)) {
                $out[$key] = ($current === true || $value === true);
            } elseif (is_numeric($current) && is_numeric($value) && str_contains($key, 'credit_per_call')) {
                $out[$key] = min((float)$current, (float)$value);
            } elseif (is_numeric($current) && is_numeric($value)) {
                $out[$key] = max((float)$current, (float)$value);
            } elseif (is_array($current) && is_array($value) && isset($current['limit'], $value['limit'])) {
                $out[$key] = (float)$value['limit'] > (float)$current['limit'] ? $value : $current;
            } else {
                $out[$key] = $value;
            }
        }
        return $out;
    }
}
