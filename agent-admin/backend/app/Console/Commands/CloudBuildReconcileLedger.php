<?php

namespace App\Console\Commands;

use App\Services\CloudBuild\CloudBuildLedgerReconcileService;
use Illuminate\Console\Command;
use InvalidArgumentException;

class CloudBuildReconcileLedger extends Command
{
    protected $signature = 'cloud-build:reconcile-ledger {file : ledger v1 JSON 路径}';

    protected $description = '对账源 ledger 与云控执行账本；零硬差异才返回成功（T5.1）';

    public function handle(CloudBuildLedgerReconcileService $service): int
    {
        $file = (string) $this->argument('file');
        try {
            $report = $service->reconcilePath($file);
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage());
            return str_contains($e->getMessage(), 'sha256') ? 2 : 1;
        }

        $this->line(json_encode($report, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
        if ($report['ok']) {
            $this->info('CLOUD_BUILD_LEDGER_RECONCILE_OK');
            return 0;
        }
        $this->error('CLOUD_BUILD_LEDGER_RECONCILE_HARD_DIFF: ' . implode(',', $report['hard_diffs']));
        return 1;
    }
}
