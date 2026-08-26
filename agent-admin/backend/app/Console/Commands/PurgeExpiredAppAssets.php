<?php

namespace App\Console\Commands;

use App\Models\AppAsset;
use App\Services\StorageService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class PurgeExpiredAppAssets extends Command
{
    protected $signature = 'assets:purge-expired {--limit=500} {--grace=60}';
    protected $description = '清理过期 App v1 用户资产';

    public function handle(): int
    {
        $cutoff = now()->subMinutes(max(0, (int) $this->option('grace')));
        $limit = max(1, min(5000, (int) $this->option('limit')));
        $failed = 0;
        $deleted = 0;
        AppAsset::whereIn('status', ['pending', 'uploaded', 'ready', 'failed'])
            ->whereNotNull('expires_at')->where('expires_at', '<', $cutoff)
            ->orderBy('id')->limit($limit)->get()->each(function (AppAsset $asset) use (&$failed, &$deleted) {
                $leased = Schema::hasTable('app_asset_task_leases')
                    && DB::table('app_asset_task_leases')->where('asset_id', $asset->id)
                        ->whereNull('released_at')->where('lease_until', '>', now())->exists();
                if ($leased) return;
                if ($asset->storage_url !== '' && !StorageService::deleteWithDriver($asset->storage_url, $asset->storage_driver)) {
                    $failed++;
                    $this->warn("asset storage delete failed: {$asset->id}");
                    return;
                }
                $asset->delete();
                $deleted++;
            });
        $this->info("app assets purged: {$deleted}; failed: {$failed}");
        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }
}
