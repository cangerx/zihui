<?php

namespace App\Console\Commands;

use App\Models\SyncBlob;
use App\Models\UserStorage;
use App\Services\StorageQuotaService;
use Illuminate\Console\Command;

/**
 * 容量对账：重算每个用户的 used_bytes（= committed blob 大小之和），纠正增量维护漂移。
 * 由 Kernel 每小时调度。
 */
class SyncReconcileStorage extends Command
{
    protected $signature = 'sync:reconcile-storage';
    protected $description = '重算用户云存储已用容量（对账纠偏）';

    public function handle(StorageQuotaService $quota): int
    {
        $userIds = SyncBlob::query()->distinct()->pluck('user_id')
            ->merge(UserStorage::query()->pluck('user_id'))
            ->unique()
            ->values();

        $count = 0;
        foreach ($userIds as $uid) {
            $quota->recompute((int) $uid);
            $count++;
        }

        $this->info("storage reconciled for {$count} users");
        return self::SUCCESS;
    }
}
