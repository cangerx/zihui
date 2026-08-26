<?php

namespace App\Console\Commands;

use App\Models\SystemSetting;
use App\Services\AgentHub\AgentHubClient;
use App\Services\CreativeTemplateHub\CreativeTemplateHubClient;
use App\Services\InspirationHub\InspirationHubClient;
use App\Services\SharedHub\DesktopInspirationImportService;
use App\Services\SharedHub\SharedHubSyncService;
use Illuminate\Console\Command;

class SharedHubSyncContent extends Command
{
    protected $signature = 'shared-hub:import-desktop
                            {--file= : 桌面 inspirations.json 路径}
                            {--force : 已灌过也再补漏}
                            {--skip-hub : 只写入本站，不推授权端}';

    protected $description = '一次性把桌面自带灵感广场灌到本站（并可推授权端 Hub），之后不再由客户端同步';

    public function handle(
        DesktopInspirationImportService $importer,
        InspirationHubClient $inspirations,
        CreativeTemplateHubClient $templates,
        AgentHubClient $agents
    ): int {
        $already = trim((string) SystemSetting::getValue('shared_hub_desktop_imported_at', ''));
        if ($already !== '' && !$this->option('force')) {
            $this->warn("已经灌过（{$already}）。本地客户端只做第一次同步。需要补漏请加 --force。");
            return self::SUCCESS;
        }

        $file = (string) ($this->option('file') ?: DesktopInspirationImportService::defaultFile());
        $import = $importer->import($file);
        $this->info(sprintf(
            '[desktop-import] imported=%d skipped=%d errors=%d file=%s',
            $import['imported'],
            $import['skipped'],
            count($import['errors']),
            $file
        ));
        foreach (array_slice($import['errors'], 0, 10) as $err) {
            $this->warn('  ' . $err);
        }

        $hub = null;
        if (!$this->option('skip-hub')) {
            $hub = SharedHubSyncService::fromClients($inspirations, $templates, $agents)->syncInspirations(500);
            $this->info(sprintf(
                '[hub-push] pushed=%d skipped=%d errors=%d',
                $hub['pushed'],
                $hub['skipped'],
                count($hub['errors'])
            ));
        }

        SystemSetting::setValue('shared_hub_desktop_imported_at', now()->toIso8601String());
        return empty($import['errors']) || $import['imported'] > 0 ? self::SUCCESS : self::FAILURE;
    }
}
