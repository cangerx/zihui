<?php

namespace App\Console\Commands;

use App\Models\Inspiration;
use App\Services\InspirationHub\InspirationHubClient;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * 与 agent-build 共享灵感库同步本站已分享灵感的 hub 状态。
 *
 * 选取条件：hub_shared_id IS NOT NULL 且满足下面任一：
 *   - hub_status IS NULL（首次分享后还没回填过）
 *   - hub_status = 'pending'（变化频繁，优先同步）
 *   - hub_status_synced_at IS NULL
 *   - hub_status_synced_at 距今 > 1 小时（终态也定期对账，hub 平台 force 操作时本地能感知）
 *
 * 流程：
 *   1. 选最多 --limit 行，按 pending 优先 + 旧同步时间优先
 *   2. 分 chunks（hub /status-batch 单次最多 100），逐批转发
 *   3. 写回 hub_status / hub_status_synced_at
 *   4. hub 返回里缺失的 shared_id（被 hub 平台删除 / 被源站撤回）→ 清本地 hub_shared_id
 *
 * 调度：在 Console/Kernel.php 注册为 every 5 minutes，withoutOverlapping。
 */
class SyncHubStatus extends Command
{
    protected $signature = 'inspiration-hub:sync-status
                            {--limit=200 : 单次同步条数上限（1-1000，默认 200）}';

    protected $description = '与共享灵感库同步本地灵感的 hub 状态';

    private const HUB_STATUS_BATCH_SIZE = 100;

    public function handle(InspirationHubClient $hub): int
    {
        if (!$hub->isReady()) {
            $this->info('[InspirationHub] sync-status: hub not ready (disabled / endpoint empty / origin empty), skip.');
            return self::SUCCESS;
        }

        $limit = (int) $this->option('limit');
        $limit = max(1, min(1000, $limit));

        $rows = Inspiration::query()
            ->whereNotNull('hub_shared_id')
            ->where(function ($q) {
                $q->whereNull('hub_status')
                    ->orWhere('hub_status', 'pending')
                    ->orWhereNull('hub_status_synced_at')
                    ->orWhere('hub_status_synced_at', '<', now()->subHour());
            })
            // pending 优先（最有可能在变化），其次按上次同步时间从旧到新
            ->orderByRaw("FIELD(hub_status, 'pending') DESC")
            ->orderBy('hub_status_synced_at', 'asc')
            ->limit($limit)
            ->get(['id', 'hub_shared_id', 'hub_status']);

        if ($rows->isEmpty()) {
            $this->info('[InspirationHub] sync-status: nothing to sync');
            return self::SUCCESS;
        }

        $this->info("[InspirationHub] sync-status: syncing {$rows->count()} rows");

        $totalSynced = 0;
        $totalCleared = 0;
        $totalErrors = 0;

        foreach ($rows->chunk(self::HUB_STATUS_BATCH_SIZE) as $chunk) {
            $sharedIds = $chunk->pluck('hub_shared_id')->map(fn ($v) => (int) $v)->all();
            $sharedToLocal = $chunk->keyBy('hub_shared_id');
            $now = now();

            try {
                $resp = $hub->post('/status-batch', ['shared_ids' => $sharedIds]);
            } catch (RuntimeException $e) {
                Log::warning('[InspirationHub] sync-status hub call failed', [
                    'error' => $e->getMessage(),
                    'count' => $chunk->count(),
                ]);
                $totalErrors += $chunk->count();
                continue;
            }

            if (!$resp->successful()) {
                Log::warning('[InspirationHub] sync-status hub returned error', [
                    'status' => $resp->status(),
                    'body'   => $resp->json(),
                    'count'  => $chunk->count(),
                ]);
                $totalErrors += $chunk->count();
                continue;
            }

            $items = $resp->json('items', []);
            $returnedSharedIds = [];

            foreach ($items as $item) {
                $sharedId = isset($item['id']) ? (int) $item['id'] : null;
                if ($sharedId === null) continue;

                $local = $sharedToLocal->get($sharedId);
                if (!$local) continue;

                Inspiration::where('id', $local->id)->update([
                    'hub_status'           => $item['status'] ?? null,
                    'hub_status_synced_at' => $now,
                ]);
                $returnedSharedIds[] = $sharedId;
                $totalSynced++;
            }

            // hub 返回里没出现的 shared_id：要么 hub 上被平台删除，要么本地分享方撤回（多端时其他站点撤的）
            // 本地清掉 hub_shared_id，让用户重新分享
            $missing = array_diff($sharedIds, $returnedSharedIds);
            if (!empty($missing)) {
                $missingLocalIds = $chunk
                    ->filter(fn ($r) => in_array((int) $r->hub_shared_id, $missing, true))
                    ->pluck('id')
                    ->all();

                if (!empty($missingLocalIds)) {
                    Inspiration::whereIn('id', $missingLocalIds)->update([
                        'hub_shared_id'        => null,
                        'hub_status'           => null,
                        'hub_status_synced_at' => $now,
                    ]);
                    $totalCleared += count($missingLocalIds);

                    Log::info('[InspirationHub] sync-status detected hub-side removal, cleared local', [
                        'local_ids' => $missingLocalIds,
                        'shared_ids' => $missing,
                    ]);
                }
            }
        }

        $this->info("[InspirationHub] sync-status done. synced={$totalSynced} cleared={$totalCleared} errors={$totalErrors}");

        return self::SUCCESS;
    }
}
