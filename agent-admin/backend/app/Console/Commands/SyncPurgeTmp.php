<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;

/**
 * 清理中途放弃的分块上传临时目录（storage/app/sync-tmp/{user}/{sha}）。
 * 正常流程 complete 后会清理当次目录；客户端断网/弃传的会永久残留，需周期回收。
 * 由 Kernel 每日调度。
 */
class SyncPurgeTmp extends Command
{
    protected $signature = 'sync:purge-tmp {--hours=48 : 超过该小时数未再写入的临时目录将被删除}';
    protected $description = '清理过期的同步分块上传临时目录';

    public function handle(): int
    {
        $hours = max(1, (int) $this->option('hours'));
        $cutoff = time() - $hours * 3600;
        $root = storage_path('app/sync-tmp');
        $removed = 0;

        if (is_dir($root)) {
            foreach (File::directories($root) as $userDir) {
                foreach (File::directories($userDir) as $shaDir) {
                    // 目录 mtime 随分块写入更新，活跃上传不会被误删
                    if (@filemtime($shaDir) !== false && filemtime($shaDir) < $cutoff) {
                        File::deleteDirectory($shaDir);
                        $removed++;
                    }
                }
                // 用户目录已空则一并移除
                if (count(File::directories($userDir)) === 0 && count(File::files($userDir)) === 0) {
                    File::deleteDirectory($userDir);
                }
            }
        }

        $this->info("stale upload tmp dirs removed: {$removed}");
        return self::SUCCESS;
    }
}
