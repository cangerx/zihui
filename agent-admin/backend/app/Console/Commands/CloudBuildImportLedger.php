<?php

namespace App\Console\Commands;

use App\Services\CloudBuild\CloudBuildLedgerImportService;
use Illuminate\Console\Command;
use InvalidArgumentException;

class CloudBuildImportLedger extends Command
{
    protected $signature = 'cloud-build:import-ledger
        {file : ledger v1 JSON 路径}
        {--after-build-id= : 从该 build_id 之后续导（不含）}
        {--limit=0 : 本批最多导入条数，0 表示全部}';

    protected $description = '幂等导入脱敏客户端打包账本（T5.1，不切换流量）';

    public function handle(CloudBuildLedgerImportService $import): int
    {
        $file = (string) $this->argument('file');
        $after = (string) $this->option('after-build-id');
        $limit = (int) $this->option('limit');
        try {
            $stats = $import->importPath($file, $after, $limit);
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage());
            return str_contains($e->getMessage(), 'sha256') ? 2 : 1;
        }

        $this->info('[CloudBuildImportLedger] imported=' . $stats['imported']
            . ' updated=' . $stats['updated']
            . ' skipped_terminal=' . $stats['skipped_terminal']
            . ' clients=' . $stats['clients']
            . ' quotas=' . $stats['quotas']
            . ' artifacts=' . $stats['artifacts']
            . ' has_more=' . ($stats['has_more'] ? '1' : '0')
            . ' next_after_build_id=' . ($stats['next_after_build_id'] ?? ''));
        return 0;
    }
}
