<?php

namespace App\Console\Commands;

use App\Services\CloudBuild\CloudBuildExecutionSettings;
use App\Services\CloudBuild\CloudBuildPurgeService;
use Illuminate\Console\Command;

class CloudBuildCleanupOrphans extends Command
{
    protected $signature = 'cloud-build:cleanup-orphans';

    protected $description = '清理无任务或终态过期的本地产物目录，不删除活动任务文件';

    public function handle(CloudBuildPurgeService $purge, CloudBuildExecutionSettings $settings): int
    {
        $stats = $purge->cleanupOrphans($settings->orphanRetentionDays);
        $this->info('[CloudBuildCleanup] purged_dirs=' . $stats['purged_dirs']
            . ' skipped_active=' . $stats['skipped_active']);
        return 0;
    }
}
