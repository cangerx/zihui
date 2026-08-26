<?php

namespace App\Console\Commands;

use App\Services\SkillCatalog\SkillCatalogSyncService;
use Illuminate\Console\Command;

class SkillCatalogSync extends Command
{
    protected $signature = 'skill-catalog:sync';

    protected $description = '从授权端 Skill Registry 增量同步目录并镜像已发布包';

    public function handle(SkillCatalogSyncService $sync): int
    {
        $result = $sync->sync();
        $this->info('[SkillCatalogSync] ok=' . ($result['ok'] ? '1' : '0')
            . ' applied=' . $result['applied']
            . ' cursor=' . $result['cursor']
            . ($result['error'] ? ' error=' . $result['error'] : ''));
        return $result['ok'] ? 0 : 1;
    }
}
