<?php

namespace App\Services;

use App\Models\SyncBlob;
use App\Models\SystemSetting;
use App\Models\UserStorage;
use Illuminate\Support\Facades\DB;

/**
 * 云存储容量服务（第三种计费模型：占用型 gauge）。
 *
 * 配额声明式计算：total = storage_default_bytes + Σ(active user_plans.storage_granted)。
 * 套餐过期 → user_plan 变 expired → 自动不计入，无需回收逻辑。
 * 已用量 used_bytes 增量维护（blob committed +size / 删除 -size），并由对账命令周期重算纠偏。
 */
class StorageQuotaService
{
    public function billingEnabled(): bool
    {
        return (bool) SystemSetting::getValue('storage_billing_enabled', false);
    }

    public function defaultBytes(): int
    {
        return (int) SystemSetting::getValue('storage_default_bytes', 0);
    }

    public function overagePolicy(): string
    {
        $p = (string) SystemSetting::getValue('storage_overage_policy', 'readonly');
        return in_array($p, ['readonly', 'reject'], true) ? $p : 'readonly';
    }

    public function maxBlobBytes(): int
    {
        $mb = (int) SystemSetting::getValue('sync_max_blob_mb', 200);
        return max(1, $mb) * 1024 * 1024;
    }

    /** 套餐赠送容量合计（仅有效套餐）。 */
    public function planBytes(int $userId): int
    {
        return (int) DB::table('user_plans')
            ->where('user_id', $userId)
            ->where('status', 'active')
            ->where(function ($q) {
                $q->whereNull('expires_at')->orWhere('expires_at', '>', now());
            })
            ->sum('storage_granted');
    }

    /** 总配额（字节）。计费关闭时返回 PHP_INT_MAX 表示不限制。 */
    public function totalQuota(int $userId): int
    {
        if (!$this->billingEnabled()) {
            return PHP_INT_MAX;
        }
        return $this->defaultBytes() + $this->planBytes($userId);
    }

    public function used(int $userId): int
    {
        return (int) (UserStorage::where('user_id', $userId)->value('used_bytes') ?? 0);
    }

    public function remaining(int $userId): int
    {
        $total = $this->totalQuota($userId);
        if ($total === PHP_INT_MAX) return PHP_INT_MAX;
        return max(0, $total - $this->used($userId));
    }

    /** 是否还能再写入 addBytes 字节。 */
    public function canStore(int $userId, int $addBytes): bool
    {
        if (!$this->billingEnabled()) return true;
        return $this->used($userId) + max(0, $addBytes) <= $this->totalQuota($userId);
    }

    /** 增量维护已用量（delta 可正可负）。 */
    public function addUsed(int $userId, int $delta): void
    {
        if ($delta === 0) return;
        DB::transaction(function () use ($userId, $delta) {
            $row = UserStorage::lockForUpdate()->find($userId);
            if (!$row) {
                $row = new UserStorage();
                $row->user_id = $userId;
                $row->used_bytes = max(0, $delta);
                $row->updated_at = now();
                $row->save();
                return;
            }
            $row->used_bytes = max(0, (int) $row->used_bytes + $delta);
            $row->updated_at = now();
            $row->save();
        });
    }

    /** 重算并落库已用量（= 该用户 committed blob 大小之和）。返回新值。 */
    public function recompute(int $userId): int
    {
        $sum = (int) SyncBlob::where('user_id', $userId)->where('status', 'committed')->sum('size');
        UserStorage::updateOrCreate(
            ['user_id' => $userId],
            ['used_bytes' => $sum, 'updated_at' => now()],
        );
        return $sum;
    }

    /** 容量信息（供 client/quota 与后台展示）。 */
    public function info(int $userId): array
    {
        $billing = $this->billingEnabled();
        $base = $this->defaultBytes();
        $plan = $this->planBytes($userId);
        $used = $this->used($userId);
        $total = $billing ? ($base + $plan) : 0; // 0 在前端表示「不限制/未开通计费」
        $percent = $total > 0 ? min(100, (int) floor($used * 100 / $total)) : 0;
        return [
            'used' => $used,
            'base_quota' => $base,
            'extra_quota' => $plan,
            // 计费关闭时 total=0，客户端据此显示「不限/未开通计费」
            'total' => $total,
            'percent' => $percent,
            'overage_policy' => $this->overagePolicy(),
            'billing_enabled' => $billing,
        ];
    }
}
