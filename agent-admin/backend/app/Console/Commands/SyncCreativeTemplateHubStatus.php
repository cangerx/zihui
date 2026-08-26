<?php

namespace App\Console\Commands;

use App\Models\CreativeTemplate;
use App\Services\CreativeTemplateHub\CreativeTemplateHubClient;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use RuntimeException;

class SyncCreativeTemplateHubStatus extends Command
{
    protected $signature = 'creative-template-hub:sync-status
                            {--limit=200 : 单次同步条数上限（1-1000，默认 200）}';

    protected $description = '与创意模板共享库同步本地模板的 hub 状态';

    private const HUB_STATUS_BATCH_SIZE = 100;

    public function handle(CreativeTemplateHubClient $hub): int
    {
        if (!$hub->isReady()) {
            $this->info('[CreativeTemplateHub] sync-status: hub not ready, skip.');
            return self::SUCCESS;
        }

        $limit = max(1, min(1000, (int) $this->option('limit')));
        $rows = CreativeTemplate::query()
            ->whereNotNull('hub_shared_id')
            ->where(function ($q) {
                $q->whereNull('hub_status')
                    ->orWhere('hub_status', 'pending')
                    ->orWhereNull('hub_status_synced_at')
                    ->orWhere('hub_status_synced_at', '<', now()->subHour());
            })
            ->orderByRaw("FIELD(hub_status, 'pending') DESC")
            ->orderBy('hub_status_synced_at', 'asc')
            ->limit($limit)
            ->get(['id', 'hub_shared_id', 'hub_status']);

        if ($rows->isEmpty()) {
            $this->info('[CreativeTemplateHub] sync-status: nothing to sync');
            return self::SUCCESS;
        }

        $this->info("[CreativeTemplateHub] sync-status: syncing {$rows->count()} rows");
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
                Log::warning('[CreativeTemplateHub] sync-status hub call failed', [
                    'error' => $e->getMessage(),
                    'count' => $chunk->count(),
                ]);
                $totalErrors += $chunk->count();
                continue;
            }

            if (!$resp->successful()) {
                Log::warning('[CreativeTemplateHub] sync-status hub returned error', [
                    'status' => $resp->status(),
                    'body' => $resp->json(),
                    'count' => $chunk->count(),
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
                CreativeTemplate::where('id', $local->id)->update([
                    'hub_status' => $item['status'] ?? null,
                    'hub_status_synced_at' => $now,
                ]);
                $returnedSharedIds[] = $sharedId;
                $totalSynced++;
            }

            $missing = array_diff($sharedIds, $returnedSharedIds);
            if (!empty($missing)) {
                $missingLocalIds = $chunk
                    ->filter(fn ($r) => in_array((int) $r->hub_shared_id, $missing, true))
                    ->pluck('id')
                    ->all();
                if (!empty($missingLocalIds)) {
                    CreativeTemplate::whereIn('id', $missingLocalIds)->update([
                        'hub_shared_id' => null,
                        'hub_status' => null,
                        'hub_status_synced_at' => $now,
                    ]);
                    $totalCleared += count($missingLocalIds);
                    Log::info('[CreativeTemplateHub] sync-status detected hub-side removal, cleared local', [
                        'local_ids' => $missingLocalIds,
                        'shared_ids' => $missing,
                    ]);
                }
            }
        }

        $this->info("[CreativeTemplateHub] sync-status done. synced={$totalSynced} cleared={$totalCleared} errors={$totalErrors}");
        return self::SUCCESS;
    }
}
