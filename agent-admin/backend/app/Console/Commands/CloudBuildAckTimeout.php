<?php

namespace App\Console\Commands;

use App\Services\CloudBuild\CloudBuildAckTimeoutService;
use Illuminate\Console\Command;

class CloudBuildAckTimeout extends Command
{
    protected $signature = 'cloud-build:ack-timeout';

    protected $description = '24h 兜底：artifact_pending → failed；ready 未拉取 → expired';

    public function handle(CloudBuildAckTimeoutService $service): int
    {
        $stats = $service->run();
        $this->info('[CloudBuildAckTimeout] failed=' . $stats['failed'] . ' expired=' . $stats['expired']);
        return 0;
    }
}
