<?php

namespace App\Console\Commands;

use App\Services\Build\BuildLedgerExportService;
use Illuminate\Console\Command;

class BuildExportLedger extends Command
{
    protected $signature = 'build:export-ledger
        {file : 输出 JSON 路径}
        {--after-build-id= : 从该 build_id 之后导出（不含）}
        {--limit=0 : 本批最多条数，0 表示全部}
        {--until= : 创建时间上界（含），用于冻结后的最终增量}';

    protected $description = '导出脱敏客户端打包账本 ledger v1（T5.1，不切换流量）';

    public function handle(BuildLedgerExportService $export): int
    {
        $packed = $export->export(
            (string) $this->option('after-build-id'),
            (int) $this->option('limit'),
            $this->option('until') ? (string) $this->option('until') : null
        );

        $path = (string) $this->argument('file');
        $dir = dirname($path);
        if ($dir !== '' && $dir !== '.' && !is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        $json = json_encode($packed, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        file_put_contents($path, $json . "\n");

        $this->info('[BuildExportLedger] jobs=' . count($packed['jobs'] ?? [])
            . ' canonical=' . ($packed['manifest']['canonical_sha256'] ?? '')
            . ' has_more=' . (!empty($packed['cursor']['has_more']) ? '1' : '0')
            . ' file=' . $path);
        return 0;
    }
}
