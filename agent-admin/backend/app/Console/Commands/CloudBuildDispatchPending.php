<?php

namespace App\Console\Commands;

use App\Services\CloudBuild\CloudBuildLocalDispatchService;
use Illuminate\Console\Command;

class CloudBuildDispatchPending extends Command
{
    protected $signature = 'cloud-build:dispatch-pending';

    protected $description = '将本地 cloud_build_jobs（queued）异步 dispatch 到 GitHub Actions';

    public function handle(CloudBuildLocalDispatchService $dispatch): int
    {
        $started = microtime(true);
        $this->info('[CloudBuildDispatchPending] started ' . now()->toDateTimeString());
        $stats = $dispatch->dispatchPending();
        $elapsed = round(microtime(true) - $started, 2);
        $this->info('[CloudBuildDispatchPending] done dispatched=' . $stats['dispatched']
            . ' retried=' . $stats['retried']
            . ' failed=' . $stats['failed']
            . ' skipped=' . $stats['skipped']
            . ' elapsed=' . $elapsed . 's');
        return 0;
    }
}
