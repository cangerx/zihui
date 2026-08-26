<?php

namespace App\Jobs;

use App\Models\BillingRule;
use App\Models\CloudModel;
use App\Models\ImageTask;
use App\Models\TemporaryReferenceAsset;
use App\Models\AppAsset;
use App\Models\UsageRecord;
use App\Services\BalanceService;
use App\Services\Gateway\GatewayRouter;
use App\Services\QuotaService;
use App\Services\StorageService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Throwable;

/**
 * 图像生成 / 编辑任务异步处理。
 *
 * 触发路径两种（由 GatewayController 按 config('queue.default') 自适应选择）：
 *   - QUEUE_CONNECTION=sync（默认 / 未配置）→ `app()->terminating` 包 Job::handle()
 *     老部署升级零配置，走伪异步路径（不需 worker，也不享受 retry / failed_jobs）
 *   - QUEUE_CONNECTION=database/redis → `ProcessImageTaskJob::dispatch($taskId)` 入队
 *     由 `php artisan queue:work database --queue=image` worker 进程拉取后调用 handle()
 *
 * 后者相对前者的优势：
 *   - 真独立进程异步，不再寄生在 PHP-FPM worker 上
 *   - tries=2 失败自动重试一次（适配器层瞬时网络抖动）
 *   - 超过 tries 落入 failed_jobs 表，可 `queue:retry {uuid}` 重跑
 *   - timeout=960 防止单任务卡死整条 worker（覆盖 image=900s + 60s buffer）
 */
class ProcessImageTaskJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /** 失败重试次数（含首次执行：tries=2 = 第一次 + 一次重试） */
    public int $tries = 2;

    /** 单任务最长执行时长（秒）。配套 gateway.timeouts.image=900，预留 60s buffer 防边界 timeout。
     *  不变量：retry_after(1020s) > $timeout(960s) > image(900s)。 */
    public int $timeout = 960;

    /**
     * 单任务失败后等待多少秒再重试（递增退避：第一次失败后 30s 再试）。
     */
    public function backoff(): int
    {
        return 30;
    }

    public function __construct(public string $taskId)
    {
        // 默认排进 'image' 队列，方便 worker 用 --queue=image 单独跑
        $this->onQueue('image');
    }

    public function handle(GatewayRouter $router): void
    {
        // 兜底取消 PHP 执行时长限制：CLI worker 路径通常无 max_execution_time（默认 0），
        // 但有些 PaaS / 自定义 php.ini 显式配了非 0 值；同一份 Job 也会在 sync driver 下被
        // GatewayController 的 terminating callback 调用（受 PHP-FPM max_execution_time 限制，
        // 宝塔默认 300s）。统一关掉防 4K / 多米慢任务被掐死。
        @set_time_limit(0);

        $task = ImageTask::find($this->taskId);

        if (!$task) {
            Log::warning("[ProcessImageTaskJob] task {$this->taskId} not found");
            return;
        }

        // 原子领取 pending 任务，避免取消接口与 worker 在“先读后写”窗口中竞态：
        // 只有成功把 pending 改成 processing 的执行者才能调用上游。
        $claimed = ImageTask::query()
            ->whereKey($this->taskId)
            ->where('status', 'pending')
            ->update(['status' => 'processing', 'updated_at' => now()]);
        if ($claimed !== 1) {
            Log::info("[ProcessImageTaskJob] task {$this->taskId} is no longer pending, skip");
            return;
        }
        $task->refresh();

        $cloudModel = CloudModel::with('provider')->find($task->cloud_model_id);
        if (!$cloudModel || !$cloudModel->provider) {
            $task->update(['status' => 'failed', 'error' => 'Model or provider not found']);
            $this->releaseAssetLeases($task->id);
            return;
        }

        // 优先从 Cache 读完整 body（含 base64 图片），Cache 失效时 fallback 到 DB 元数据。
        // Cache key：itask:body:{taskId}，由 GatewayController::handleImage 写入，TTL 30min。
        $bodyCacheKey = "itask:body:{$task->id}";
        // Keep the request body until the task reaches a terminal state so a queue retry
        // can still access inline images (the DB copy intentionally strips base64 fields).
        $body = Cache::get($bodyCacheKey) ?? $task->request_body;

        $route = null;

        try {
            // Include adapter/credential selection in the retry boundary. A provider or
            // credential-pool failure must not leave the task stuck in processing.
            $route = $router->route($cloudModel);
            // 新链路：桌面端云端生图改为只传 image_urls / mask_url（本站临时素材 URL），不再内联
            // base64。这里读回裸 base64 填入上游适配器认识的 images / mask 字段；向后兼容老链路。
            $this->renewAssetLeasesOnce($task->id);
            $body = $this->materializeReferenceUrls($body, (int) $task->user_id, $task->id);
            $resp = $route->adapter->image($task->endpoint, $body, $route->provider, $route->apiKey);
        } catch (Throwable $e) {
            if ($route !== null) {
                $router->markCredentialFailure($route->credential, $e->getMessage());
            }
            if ($this->shouldRetry()) {
                // Queue will re-run this job; leave it claimable and retain the body/leases.
                $task->update(['status' => 'pending', 'error' => 'Retry scheduled: ' . $e->getMessage()]);
            } else {
                $task->update(['status' => 'failed', 'error' => $e->getMessage()]);
                $this->recordUsage($task, $cloudModel, 0, 'failed', $e->getMessage());
                $this->releaseAssetLeases($task->id);
                Cache::forget($bodyCacheKey);
            }
            // 抛出给 Queue 让其按 tries 决定是否重试
            throw $e;
        }

        if (!$resp->ok) {
            $errorMsg = $resp->errorMessage ?? 'Upstream error';
            if (is_array($resp->data) && isset($resp->data['error'])) {
                $errorMsg = $resp->data['error']['message']
                    ?? (is_string($resp->data['error']) ? $resp->data['error'] : $errorMsg);
            }
            $router->markCredentialFailure($route->credential, $errorMsg);
            $task->update(['status' => 'failed', 'error' => $errorMsg]);
            $this->recordUsage($task, $cloudModel, 0, 'failed', $errorMsg);
            $this->releaseAssetLeases($task->id);
            Cache::forget($bodyCacheKey);
            // 上游业务错误不应重试（比如 prompt 违规、quota 用尽），直接结束。
            return;
        }

        $router->markCredentialSuccess($route->credential);
        $data = $resp->data ?? [];

        $user = $task->user;
        $billingRule = $this->getBillingRule($cloudModel, $user);
        $creditsUsed = $billingRule ? (float) $billingRule->credit_per_call : 0;
        $deduction = ['source_plan_id' => null];
        if ($creditsUsed > 0) {
            $deduction = app(BalanceService::class)->deduct($user, 'credit', $creditsUsed, 'usage', "image {$task->request_id}", (string)$task->request_id);
        }
        app(QuotaService::class)->consumeForType($user, 'image', 1);

        // 完整 result 写 Cache，task 入库剥 base64
        Cache::put("itask:result:{$task->id}", $data, now()->addHour());
        $task->update([
            'status' => 'completed',
            'result' => $this->stripBase64FromResult($data),
            'cost'   => $creditsUsed,
        ]);
        Cache::forget($bodyCacheKey);
        $this->releaseAssetLeases($task->id);
        $this->recordUsage($task, $cloudModel, $creditsUsed, 'success', '', $deduction['source_plan_id']);
    }

    /**
     * 超过 tries 上限或 timeout 时由 Queue worker 调用。
     * 仅做兜底状态记录，业务侧错误已在 handle() 内更新过 task。
     */
    public function failed(Throwable $e): void
    {
        $task = ImageTask::find($this->taskId);
        if ($task && !in_array($task->status, ['completed', 'failed'], true)) {
            $task->update(['status' => 'failed', 'error' => 'Job failed: ' . $e->getMessage()]);
        }
        $this->releaseAssetLeases($this->taskId);
        Cache::forget("itask:body:{$this->taskId}");
        Log::error("[ProcessImageTaskJob] {$this->taskId} permanently failed: {$e->getMessage()}");
    }

    private function getBillingRule(CloudModel $cloudModel, $user): ?BillingRule
    {
        $rule = BillingRule::where('cloud_model_id', $cloudModel->id)
            ->where('target_type', 'user')
            ->where('target_id', $user->id)
            ->first();
        if ($rule) return $rule;

        $groupIds = $user->groups()->pluck('user_groups.id')->toArray();
        if (!empty($groupIds)) {
            $rule = BillingRule::where('cloud_model_id', $cloudModel->id)
                ->where('target_type', 'group')
                ->whereIn('target_id', $groupIds)
                ->orderBy('input_price')
                ->first();
            if ($rule) return $rule;
        }

        return BillingRule::where('cloud_model_id', $cloudModel->id)
            ->where('target_type', 'default')
            ->first();
    }

    /**
     * 新链路参考图换 URL 兜底：把 body 里的 image_urls / mask_url（桌面端云端生图传入的本站
     * 临时素材 URL）读回裸 base64，填入上游适配器认识的 images / mask 字段。适配器层无需改动；
     * 向后兼容——老链路直接传 images(base64) 时本方法只清理多余字段、不改图片数据。
     *
     * 安全（防 SSRF）：只放行确实是本站为「该用户」签发的临时素材（temporary_reference_assets
     * 表内 storage_url + user_id 命中），其余 URL 一律忽略，绝不去下载任意外部 / 内网地址。
     * 读取走 StorageService::readBytes，自动兼容 cos / oss / local 三种存储后端。
     */
    private function materializeReferenceUrls(array $body, int $userId, string $taskId = ''): array
    {
        if (isset($body['_app_asset_ids']) && is_array($body['_app_asset_ids']) && Schema::hasTable('app_assets')) {
            if (!Schema::hasTable('app_asset_task_leases')) {
                throw new \RuntimeException('参考图租约表不可用');
            }
            $ids = array_values(array_filter($body['_app_asset_ids'], 'is_string'));
            $ids = array_map(static fn (string $id) => strtolower(trim($id)), $ids);
            $resolvedAssets = AppAsset::where('user_id', $userId)->where('kind', 'image')
                ->whereIn('id', $ids)->where('status', 'ready')
                ->whereNotNull('storage_url')->where('storage_url', '<>', '')
                ->whereExists(function ($q) use ($taskId) {
                    $q->selectRaw('1')->from('app_asset_task_leases')
                        ->whereColumn('app_asset_task_leases.asset_id', 'app_assets.id')
                        ->where('app_asset_task_leases.task_id', $taskId)
                        ->whereNull('released_at')->where('lease_until', '>', now());
                })
                ->get(['id', 'storage_url'])->keyBy('id');
            if ($resolvedAssets->count() !== count($ids)) {
                throw new \RuntimeException('参考图租约无效或已过期');
            }
            $resolved = collect($ids)->map(fn ($id) => $resolvedAssets[(string) $id]->storage_url)->all();
            $body['image_urls'] = $resolved;
        }
        unset($body['_app_asset_ids']);
        $imageUrls = (isset($body['image_urls']) && is_array($body['image_urls']))
            ? array_values(array_filter($body['image_urls'], fn ($u) => is_string($u) && $u !== ''))
            : [];
        $maskUrl = (isset($body['mask_url']) && is_string($body['mask_url']) && $body['mask_url'] !== '')
            ? $body['mask_url']
            : null;

        // 非上游协议字段，无论是否命中都要剥掉，避免透传给上游
        unset($body['image_urls'], $body['mask_url']);

        if (empty($imageUrls) && $maskUrl === null) {
            return $body;
        }

        $lookup = array_values(array_unique(array_merge($imageUrls, $maskUrl !== null ? [$maskUrl] : [])));
        $assets = TemporaryReferenceAsset::where('user_id', $userId)
            ->whereIn('storage_url', $lookup)
            ->get(['storage_url', 'storage_driver'])
            ->keyBy('storage_url');
        $appAssets = collect();
        if (Schema::hasTable('app_assets')) {
            $appAssetQuery = AppAsset::where('user_id', $userId)
                ->where('kind', 'image')->whereIn('storage_url', $lookup)
                ->where('status', 'ready')
                ->where('expires_at', '>', now());
            // Legacy deployments may have app_assets without the lease migration yet. Keep
            // TemporaryReferenceAsset URL tasks working there; new asset_ids tasks fail closed
            // above when the lease table is unavailable.
            if (Schema::hasTable('app_asset_task_leases')) {
                $appAssetQuery->orWhere(function ($q) use ($taskId, $userId, $lookup) {
                    $q->where('user_id', $userId)->where('kind', 'image')->whereIn('storage_url', $lookup)
                        ->where('status', 'ready')
                        ->whereExists(function ($sq) use ($taskId) {
                            $sq->selectRaw('1')->from('app_asset_task_leases')
                                ->whereColumn('app_asset_task_leases.asset_id', 'app_assets.id')
                                ->where('app_asset_task_leases.task_id', $taskId)
                                ->whereNull('released_at')->where('lease_until', '>', now());
                        });
                });
            }
            $appAssets = $appAssetQuery->get(['storage_url', 'storage_driver'])->keyBy('storage_url');
        }
        $assets = $assets->union($appAssets);

        $readBase64 = function (string $url) use ($assets): ?string {
            $asset = $assets->get($url);
            if (!$asset) {
                Log::warning("[ProcessImageTaskJob] 拒绝非本站/非本人参考图 URL（防 SSRF）：{$url}");
                return null;
            }
            $bytes = StorageService::readBytes($asset->storage_url, $asset->storage_driver);
            if ($bytes === null || $bytes === '') {
                throw new \RuntimeException("参考图读取失败：{$url}");
            }
            return base64_encode($bytes);
        };

        if (!empty($imageUrls)) {
            $images = (isset($body['images']) && is_array($body['images'])) ? $body['images'] : [];
            foreach ($imageUrls as $url) {
                $b64 = $readBase64($url);
                if ($b64 !== null) $images[] = $b64;
            }
            if (!empty($images)) $body['images'] = $images;
        }

        if ($maskUrl !== null && empty($body['mask'])) {
            $b64 = $readBase64($maskUrl);
            if ($b64 !== null) $body['mask'] = $b64;
        }

        return $body;
    }

    /**
     * 剥离响应里的 base64 图片，只保留入库必要元数据。
     */
    private function stripBase64FromResult(array $data): array
    {
        if (isset($data['data']) && is_array($data['data'])) {
            foreach ($data['data'] as $i => $item) {
                if (is_array($item) && array_key_exists('b64_json', $item)) {
                    $len = is_string($item['b64_json']) ? strlen($item['b64_json']) : 0;
                    unset($data['data'][$i]['b64_json']);
                    $data['data'][$i]['_has_b64'] = true;
                    $data['data'][$i]['_b64_length'] = $len;
                }
            }
        }
        return $data;
    }

    private function recordUsage(ImageTask $task, CloudModel $cloudModel, float $cost, string $status, string $remark = '', ?int $sourcePlanId = null): void
    {
        UsageRecord::create([
            'user_id' => $task->user_id,
            'cloud_model_id' => $cloudModel->id,
            'type' => 'image',
            'prompt_tokens' => 0,
            'completion_tokens' => 0,
            'total_tokens' => 0,
            'credits_used' => $cost,
            'cost' => $cost,
            'balance_type' => 'credit',
            'source_plan_id' => $sourcePlanId,
            'status' => $status,
            'request_id' => $task->request_id,
            'remark' => $remark,
        ]);
    }

    private function releaseAssetLeases(string $taskId): void
    {
        if (!Schema::hasTable('app_asset_task_leases')) return;
        \Illuminate\Support\Facades\DB::table('app_asset_task_leases')
            ->where('task_id', $taskId)->whereNull('released_at')
            ->update(['released_at' => now(), 'updated_at' => now()]);
    }

    /** Queue attempts() is zero for the sync/terminating path, which is terminal by definition. */
    private function shouldRetry(): bool
    {
        try {
            $attempts = $this->attempts();
        } catch (Throwable) {
            return false;
        }
        return $attempts > 0 && $attempts < $this->tries;
    }

    /** Extend each task lease at most once when a long-running job approaches expiry. */
    private function renewAssetLeasesOnce(string $taskId): void
    {
        if (!Schema::hasTable('app_asset_task_leases')) return;
        $query = \Illuminate\Support\Facades\DB::table('app_asset_task_leases')
            ->where('task_id', $taskId)->whereNull('released_at')
            ->where('lease_until', '<=', now()->addMinutes(5));
        if (Schema::hasColumn('app_asset_task_leases', 'extension_count')) {
            $query->where('extension_count', 0);
            $query->update([
                'lease_until' => now()->addHours(2), 'extension_count' => 1,
                'updated_at' => now(),
            ]);
            return;
        }
        // Compatibility with installations created before extension_count was added.
        $query->update(['lease_until' => now()->addHours(2), 'updated_at' => now()]);
    }
}
