<?php

namespace App\Console\Commands;

use App\Models\SyncBlob;
use App\Models\SyncRecord;
use App\Services\StorageQuotaService;
use App\Services\StorageService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;

/**
 * Blob 垃圾回收：删除「不再被任何同步记录引用」且超过宽限期的 committed blob。
 * 引用集合通过扫描各用户未删除的 sync_records.payload.blobs[].sha256 计算。
 * 由 Kernel 每小时调度。
 */
class SyncGcBlobs extends Command
{
    protected $signature = 'sync:gc-blobs {--grace=24 : 孤儿保留宽限小时数}';
    protected $description = '回收无引用的同步媒体 blob（删文件 + DB + 容量）';

    public function handle(StorageQuotaService $quota): int
    {
        $graceHours = max(0, (int) $this->option('grace'));
        $cutoff = now()->subHours($graceHours);

        $userIds = SyncBlob::query()->where('status', 'committed')->distinct()->pluck('user_id');
        $removed = 0;

        foreach ($userIds as $uid) {
            $uid = (int) $uid;
            $referenced = $this->referencedShas($uid);

            $orphans = SyncBlob::where('user_id', $uid)
                ->where('status', 'committed')
                ->where('updated_at', '<', $cutoff)
                ->get();

            foreach ($orphans as $blob) {
                if (isset($referenced[$blob->sha256])) continue;
                $this->deleteBlobFile($uid, $blob);
                $blob->delete();
                $removed++;
            }

            $quota->recompute($uid);
        }

        $this->info("orphan blobs removed: {$removed}");
        return self::SUCCESS;
    }

    /** 该用户所有未删除记录引用到的 sha 集合。 */
    private function referencedShas(int $userId): array
    {
        $set = [];
        SyncRecord::where('user_id', $userId)
            ->where('deleted', false)
            ->whereNotNull('payload')
            ->select('payload')
            ->chunk(500, function ($rows) use (&$set) {
                foreach ($rows as $r) {
                    $payload = json_decode((string) $r->payload, true);
                    $blobs = $payload['blobs'] ?? null;
                    if (is_array($blobs)) {
                        foreach ($blobs as $b) {
                            $sha = $b['sha256'] ?? null;
                            if (is_string($sha) && $sha !== '') $set[$sha] = true;
                        }
                    }
                }
            });
        return $set;
    }

    private function deleteBlobFile(int $userId, SyncBlob $blob): void
    {
        try {
            if ($blob->storage_driver === 'local') {
                $path = storage_path('app/' . ltrim((string) $blob->storage_url, '/'));
                if (is_file($path)) File::delete($path);
            } else {
                StorageService::deleteWithDriver((string) $blob->storage_url, $blob->storage_driver);
            }
        } catch (\Throwable $e) {
            // best-effort：宁可留孤儿文件待下次清理，也不阻塞
        }
    }
}
