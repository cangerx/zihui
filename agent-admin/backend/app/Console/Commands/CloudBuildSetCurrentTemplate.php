<?php

namespace App\Console\Commands;

use App\Models\CloudBuildTemplate;
use Illuminate\Console\Command;
use InvalidArgumentException;

class CloudBuildSetCurrentTemplate extends Command
{
    protected $signature = 'cloud-build:set-current-template
        {version : 模板版本号，如 1.3.0}
        {--changelog= : 可选 changelog；仅在新插入或显式传入时写入}';

    protected $description = '幂等设置 cloud_build_templates 当前版本，不加入定时任务';

    public function handle(): int
    {
        $version = (string) $this->argument('version');
        $changelog = $this->option('changelog');
        $changelog = is_string($changelog) && $changelog !== '' ? $changelog : null;

        try {
            $row = CloudBuildTemplate::setCurrent($version, $changelog);
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage());
            return 1;
        }

        $this->info('CLOUD_BUILD_TEMPLATE_CURRENT=' . $row->version);
        return 0;
    }
}
