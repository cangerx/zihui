<?php

namespace App\Console\Commands;

use App\Services\Video\TemporaryReferenceAssetService;
use Illuminate\Console\Command;

/**
 * 清理已过期的临时参考素材（桌面端上传的视频参考图/视频/音频）。
 *
 * temporary_reference_assets 上传时写 expires_at = now()+24h，但历史上没有任何任务
 * 真正删除它们，导致 COS / 本地磁盘的文件和 DB 记录无限堆积成孤儿。
 *
 * 本命令由 Kernel 每小时调度一次，按 expires_at 把过期素材连同文件一起删除。
 * 默认留 60 分钟宽限（grace），避免删掉刚过期但任务仍在引用的素材。
 */
class PurgeExpiredReferenceAssets extends Command
{
    protected $signature = 'video:purge-reference-assets
        {--limit=1000 : 单次最多清理条数}
        {--grace=60 : 过期后的宽限分钟数}';

    protected $description = '清理已过期的临时参考素材（删文件 + DB 记录）';

    public function handle(TemporaryReferenceAssetService $service): int
    {
        $limit = (int) $this->option('limit');
        $grace = (int) $this->option('grace');

        $deleted = $service->purgeExpired($limit, $grace);

        $this->info("temp reference assets purged: {$deleted}");
        return self::SUCCESS;
    }
}
