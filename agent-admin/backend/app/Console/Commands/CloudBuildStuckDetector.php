<?php

namespace App\Console\Commands;

use App\Services\CloudBuild\CloudBuildStuckDetectorService;
use Illuminate\Console\Command;

class CloudBuildStuckDetector extends Command
{
    protected $signature = 'cloud-build:stuck-detector';

    protected $description = 'building 超过 20min 的本地任务 → 取消 GitHub run 并终态化';

    public function handle(CloudBuildStuckDetectorService $service): int
    {
        $stats = $service->run();
        $this->info('[CloudBuildStuckDetector] failed=' . $stats['failed'] . ' cancelled=' . $stats['cancelled']);
        return 0;
    }
}
