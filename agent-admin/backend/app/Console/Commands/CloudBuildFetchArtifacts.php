<?php

namespace App\Console\Commands;

use App\Services\CloudBuild\CloudBuildArtifactFetchService;
use Illuminate\Console\Command;

class CloudBuildFetchArtifacts extends Command
{
    protected $signature = 'cloud-build:fetch-artifacts';

    protected $description = '将 artifact_pending 的 GitHub Release 产物抓到本地存储';

    public function handle(CloudBuildArtifactFetchService $fetch): int
    {
        $stats = $fetch->fetchPending();
        $this->info('[CloudBuildFetch] fetched=' . $stats['fetched']
            . ' retried=' . $stats['retried']
            . ' failed=' . $stats['failed']
            . ' skipped=' . $stats['skipped']);
        return 0;
    }
}
