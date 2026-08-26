<?php

namespace App\Http\Controllers;

use App\Jobs\ProcessImageTaskJob;
use App\Models\CloudModel;
use App\Models\BillingRule;
use App\Models\ModelAssignment;
use App\Models\ImageTask;
use App\Models\AppAsset;
use App\Services\BalanceService;
use App\Services\Gateway\NewGatewayService;
use App\Services\QuotaService;
use App\Services\RateLimitService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class GatewayController extends Controller
{
    public function chatCompletions(Request $request)
    {
        $user = auth()->user();
        $modelId = $request->input('model');
        // 桌面端 v0.6.4+ 携带 cloud_model_id（cloud_models.id 主键）作为精确路由凭据。
        // 老版本不带该字段时按 model_id + type 走老逻辑（保持向后兼容）。
        $cloudModelId = $request->input('cloud_model_id');

        if (!$modelId) {
            return response()->json(['error' => 'model is required'], 400);
        }

        $cloudModel = $this->resolveAndAuthorize($user, $modelId, 'chat', $cloudModelId ? (int) $cloudModelId : null);
        if ($cloudModel instanceof \Illuminate\Http\JsonResponse) return $cloudModel;

        $billingRule = $this->getBillingRule($cloudModel, $user);
        $requestId = Str::uuid()->toString();

        $policies = app(QuotaService::class)->policies($user);
        $preflight = $this->preflight($user, 'chat', 1, $policies);
        if ($preflight) return $preflight;

        if ($billingRule && in_array($billingRule->billing_type, ['token', 'credit'], true)) {
            $balanceType = $this->balanceTypeForBillingRule($billingRule);
            $balance = app(BalanceService::class)->totalBalance($user->id, $balanceType);
            $needed = $this->estimateChatCost($billingRule, $request);
            $error = $balanceType === 'credit' ? 'Insufficient credit balance' : 'Insufficient token balance';
            if ($needed > 0 && $balance + 0.0000001 < $needed) {
                return response()->json(['error' => $error, 'balance_type' => $balanceType, 'needed' => $needed, 'current' => $balance], 402);
            }
            if ($needed <= 0 && $balance <= 0) {
                return response()->json(['error' => $error, 'balance_type' => $balanceType, 'needed' => 0, 'current' => $balance], 402);
            }
        }

        // 统一走新链路（适配器架构 + 凭证池 + CapabilityFilter），老链路已下线。
        return app(NewGatewayService::class)
            ->handleChat($request, $user, $cloudModel, $billingRule, $requestId);
    }

    public function imageGenerations(Request $request)
    {
        return $this->handleImage($request, 'generations');
    }

    public function imageEdits(Request $request)
    {
        return $this->handleImage($request, 'edits');
    }

    public function embeddings(Request $request)
    {
        $user = auth()->user();
        $modelId = $request->input('model');
        $cloudModelId = $request->input('cloud_model_id');

        if (!$modelId) {
            return response()->json(['error' => 'model is required'], 400);
        }

        $cloudModel = $this->resolveAndAuthorize($user, $modelId, 'embedding', $cloudModelId ? (int) $cloudModelId : null);
        if ($cloudModel instanceof \Illuminate\Http\JsonResponse) return $cloudModel;

        $billingRule = $this->getBillingRule($cloudModel, $user);
        $requestId = Str::uuid()->toString();

        $policies = app(QuotaService::class)->policies($user);
        $amount = $this->inputChars($request->input('input'));
        $preflight = $this->preflight($user, 'embedding', $amount, $policies);
        if ($preflight) return $preflight;

        if ($billingRule && $billingRule->billing_type === 'token') {
            $balance = app(BalanceService::class)->totalBalance($user->id, 'token');
            $needed = $this->estimateEmbeddingCost($billingRule, $request->input('input'));
            if ($needed > 0 && $balance + 0.0000001 < $needed) {
                return response()->json(['error' => 'Insufficient token balance', 'balance_type' => 'token', 'needed' => $needed, 'current' => $balance], 402);
            }
            if ($needed <= 0 && $balance <= 0) {
                return response()->json(['error' => 'Insufficient token balance', 'balance_type' => 'token', 'needed' => 0, 'current' => $balance], 402);
            }
        }

        return app(NewGatewayService::class)
            ->handleEmbeddings($request, $user, $cloudModel, $billingRule, $requestId);
    }

    // ===== Private Helpers =====

    private function handleImage(Request $request, string $endpoint)
    {
        $user = auth()->user();
        $modelId = $request->input('model');
        $cloudModelId = $request->input('cloud_model_id');

        if (!$modelId) {
            return response()->json(['error' => 'model is required'], 400);
        }

        $cloudModel = $this->resolveAndAuthorize($user, $modelId, 'image', $cloudModelId ? (int) $cloudModelId : null);
        if ($cloudModel instanceof \Illuminate\Http\JsonResponse) return $cloudModel;

        $billingRule = $this->getBillingRule($cloudModel, $user);
        $requestId = Str::uuid()->toString();

        $policies = app(QuotaService::class)->policies($user);
        $preflight = $this->preflight($user, 'image', 1, $policies);
        if ($preflight) return $preflight;

        if ($billingRule && $billingRule->billing_type === 'credit') {
            $balance = app(BalanceService::class)->totalBalance($user->id, 'credit');
            $needed = (float)$billingRule->credit_per_call;
            if ($balance < $needed) {
                return response()->json(['error' => 'Insufficient credit balance', 'balance_type' => 'credit', 'needed' => $needed, 'current' => $balance], 402);
            }
        }

        // 转发上游前剥掉 cloud_model_id（非上游协议字段，仅用于本网关路由）
        $body = $request->except(['_token', 'cloud_model_id']);
        $body['model'] = $cloudModel->model_id;
        // App v1 assets are injected by TaskController as trusted attributes. Never trust
        // app_asset_ids supplied in a public gateway body (it is an internal control field).
        $appAssetIds = array_values(array_filter((array) $request->attributes->get('_trusted_app_asset_ids', []), 'is_string'));
        $appAssetIds = array_map(static fn (string $id) => strtolower(trim($id)), $appAssetIds);
        unset($body['app_asset_ids'], $body['_app_asset_ids']);
        if ($appAssetIds !== []) unset($body['image_urls']);

        // Create async task
        $taskId = Str::uuid()->toString();

        // 入库前剥离 base64 图片字段（images / mask / image），避免单条记录瘦至 MB 级。
        // 完整 body（含 base64）仅用 Cache 临时传递给 ProcessImageTask，TTL 30 分钟。
        if ($appAssetIds !== []) $body['_app_asset_ids'] = $appAssetIds;
        Cache::put("itask:body:{$taskId}", $body, now()->addMinutes(30));

        $persistedBody = $this->stripBase64FromRequestBody($body);
        if ($appAssetIds !== []) unset($persistedBody['image_urls']);
        if ($appAssetIds !== []) $persistedBody['_app_asset_ids'] = $appAssetIds;

        $assetError = null;
        DB::transaction(function () use ($taskId, $user, $cloudModel, $endpoint, $persistedBody, $requestId, $appAssetIds, &$assetError) {
            if ($appAssetIds !== []) {
                if (!Schema::hasTable('app_assets') || !Schema::hasTable('app_asset_task_leases')) {
                    $assetError = 'storage_unavailable';
                    return;
                }
                $assets = AppAsset::query()->where('user_id', $user->id)->where('kind', 'image')
                    ->where('status', 'ready')->whereNotNull('storage_url')->where('storage_url', '<>', '')
                    ->where('expires_at', '>', now())->whereIn('id', $appAssetIds)
                    ->lockForUpdate()->get(['id']);
                if ($assets->count() !== count($appAssetIds)) {
                    $assetError = 'invalid_asset_ids';
                    return;
                }
            }

            ImageTask::create([
                'id' => $taskId,
                'user_id' => $user->id,
                'cloud_model_id' => $cloudModel->id,
                'endpoint' => $endpoint,
                'request_body' => $persistedBody,
                'status' => 'pending',
                'request_id' => $requestId,
            ]);

            if ($appAssetIds !== [] && Schema::hasTable('app_asset_task_leases')) {
                $leaseUntil = now()->addHours(2);
                foreach ($appAssetIds as $assetId) {
                    DB::table('app_asset_task_leases')->updateOrInsert(
                        ['asset_id' => $assetId, 'task_id' => $taskId],
                        ['lease_until' => $leaseUntil, 'released_at' => null, 'updated_at' => now(), 'created_at' => now()]
                    );
                }
            }
        });

        if ($assetError !== null) {
            $status = $assetError === 'storage_unavailable' ? 503 : 422;
            return response()->json(['error' => $assetError, 'message' => '参考图不可用'], $status);
        }

        // 自适应 driver：保证老部署升级零配置即可用。
        //   - QUEUE_CONNECTION=sync（默认 / 未配置）→ 老兼容：response 发完后用 terminating
        //     包装在当前 PHP-FPM 进程同步跑 Job::handle()，等同于旧 `Artisan::call('image:process')` 行为
        //   - QUEUE_CONNECTION=database / redis → 真异步：dispatch 入队，由长驻 worker 拉取
        //     启动：`php artisan queue:work database --queue=image,default --tries=2 --timeout=960 --sleep=2`
        if (config('queue.default', 'sync') === 'sync') {
            app()->terminating(function () use ($taskId) {
                // 取消 PHP-FPM max_execution_time 限制（宝塔默认 300s，会掐死多米 4K 长任务）。
                // Job::handle 内也会再做一次 set_time_limit(0)，这里提前到 terminating 入口更稳。
                @set_time_limit(0);
                try {
                    app()->call([new ProcessImageTaskJob($taskId), 'handle']);
                } catch (\Throwable $e) {
                    Log::error("[ProcessImageTaskJob.terminating] {$taskId}: {$e->getMessage()}");
                    // terminating callback 抛异常会被 Laravel 吞掉，这里兜底把 task 状态翻 failed
                    ImageTask::where('id', $taskId)
                        ->whereNotIn('status', ['completed', 'failed'])
                        ->update(['status' => 'failed', 'error' => 'Job exception: ' . $e->getMessage()]);
                }
            });
        } else {
            ProcessImageTaskJob::dispatch($taskId)->afterCommit();
        }

        return response()->json(['task_id' => $taskId, 'status' => 'pending']);
    }

    /**
     * 剥离 request_body 里的 base64 图片字段，只保留入库必要的元数据。
     * OpenAI/SD 图片接口 base64 字段：
     *   - images  (array of base64，用于 edits 参考图)
     *   - mask    (base64，用于 edits 蒙版)
     *   - image   (base64，用于 variations)
     * 剥离后同步写入 _images_count / _has_mask / _has_image 作为审计元信息。
     */
    private function stripBase64FromRequestBody(array $body): array
    {
        if (isset($body['images']) && is_array($body['images'])) {
            $body['_images_count'] = count($body['images']);
            unset($body['images']);
        }
        if (isset($body['mask'])) {
            $body['_has_mask'] = true;
            unset($body['mask']);
        }
        if (isset($body['image'])) {
            $body['_has_image'] = true;
            unset($body['image']);
        }
        return $body;
    }

    public function imageTaskStatus(Request $request, string $taskId)
    {
        $user = auth()->user();
        $task = ImageTask::where('id', $taskId)->where('user_id', $user->id)->first();

        if (!$task) {
            return response()->json(['error' => 'Task not found'], 404);
        }

        $resp = [
            'task_id' => $task->id,
            'status' => $task->status,
        ];

        if ($task->status === 'completed') {
            // 优先从 Cache 读完整 result（含 b64_json），失效时 fallback 到 DB 元数据。
            $fullResult = Cache::get("itask:result:{$taskId}");
            $resp['result'] = $fullResult ?? $task->result;
        } elseif ($task->status === 'failed') {
            $resp['error'] = $task->error;
        }

        return response()->json($resp);
    }

    /**
     * 把请求里的 model 标识解析为唯一的 CloudModel，并校验当前用户有权使用该模型。
     *
     * 多家服务商可以同时提供同一个 model_id（cloud_models 唯一索引是 (provider_id, model_id)），
     * 单凭 `model_id` 字符串查询会陷入 `first()` 错位 —— 桌面端选 A 家可能被路由到 B 家、
     * 按 B 家的 BillingRule 扣费，usage_records 也记到 B 家名下。
     *
     * 桌面端 v0.6.4+ 在请求体里携带 `cloud_model_id`（cloud_models.id 主键）作为精确路由凭据；
     * 老版本不带该字段时按 `model_id + type` 走兼容查询（保留旧行为，避免在途请求断流）。
     *
     * @param int|null $cloudModelId 桌面端 v0.6.4+ 携带；为 null 时走老的 model_id 兜底
     */
    private function resolveAndAuthorize($user, string $modelId, string $type, ?int $cloudModelId = null)
    {
        $cloudModel = null;

        if ($cloudModelId !== null) {
            // 主键精确路由：严格按 id + type 命中，不再降级到 model_id 兜底，
            // 避免主键失效时再次掉进 first() 错位的坑。
            $cloudModel = CloudModel::where('id', $cloudModelId)
                ->where('type', $type)
                ->where('status', 'active')
                ->with('provider')
                ->first();

            if (!$cloudModel) {
                return response()->json([
                    'error' => 'Model not found or disabled: cloud_model_id=' . $cloudModelId,
                ], 404);
            }
        } else {
            // 兼容老客户端 / 桌面端启动竞态：未携带 cloud_model_id。
            // 按 model_id + type 查；命中多家（多服务商提供同名模型）时**不再 first() 兜底**——
            // 那样会把用户选的 A 家错路由到 B 家、按 B 家 BillingRule 错扣费。改为返回明确错误，
            // 提示客户端重新拉取模型列表后重试（届时会带上 cloud_model_id 精确路由）。
            $candidates = CloudModel::where('model_id', $modelId)
                ->where('type', $type)
                ->where('status', 'active')
                ->with('provider')
                ->get();

            if ($candidates->count() > 1) {
                return response()->json([
                    'error' => '该模型由多个服务商提供，无法唯一确定路由，请在客户端重新拉取模型列表后重试',
                    'code'  => 'ambiguous_model',
                ], 409);
            }

            $cloudModel = $candidates->first();

            if (!$cloudModel) {
                // 回退：忽略 type 再查一次（仍要求唯一，避免跨 type 同名错路由）
                $anyType = CloudModel::where('model_id', $modelId)
                    ->where('status', 'active')
                    ->with('provider')
                    ->get();
                if ($anyType->count() > 1) {
                    return response()->json([
                        'error' => '该模型由多个服务商提供，无法唯一确定路由，请在客户端重新拉取模型列表后重试',
                        'code'  => 'ambiguous_model',
                    ], 409);
                }
                $cloudModel = $anyType->first();
            }

            if (!$cloudModel) {
                return response()->json(['error' => 'Model not found: ' . $modelId], 404);
            }
        }

        if (!$cloudModel->provider || $cloudModel->provider->status !== 'active') {
            return response()->json(['error' => 'Provider disabled'], 403);
        }

        // Check authorization: user directly assigned or via group
        $directAssigned = ModelAssignment::where('cloud_model_id', $cloudModel->id)
            ->where('assignee_type', 'user')
            ->where('assignee_id', $user->id)
            ->exists();

        if (!$directAssigned) {
            $groupIds = $user->groups()->pluck('user_groups.id')->toArray();
            $groupAssigned = !empty($groupIds) && ModelAssignment::where('cloud_model_id', $cloudModel->id)
                ->where('assignee_type', 'group')
                ->whereIn('assignee_id', $groupIds)
                ->exists();

            if (!$groupAssigned) {
                return response()->json(['error' => 'You do not have access to this model'], 403);
            }
        }

        return $cloudModel;
    }

    private function getBillingRule($cloudModel, $user): ?BillingRule
    {
        // Priority: user-specific > group-specific > default
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

    private function preflight($user, string $scope, int $amount, array $policies)
    {
        try {
            app(QuotaService::class)->assertAvailableForType($user, $scope, $amount);
            $rateLimit = app(RateLimitService::class);
            $rateLimit->assertAllowed($user, $scope, $rateLimit->effectiveLimits($user, $scope, $policies));
            return null;
        } catch (\Throwable $e) {
            return response()->json(['error' => $e->getMessage()], 429);
        }
    }

    private function estimateChatCost(BillingRule $rule, Request $request): float
    {
        if (!in_array($rule->billing_type, ['token', 'credit'], true)) return 0;

        $inputTokens = $this->estimateTokens($request->input('messages', $request->input('prompt', '')));
        $maxTokens = (int)$request->input('max_tokens', $request->input('max_completion_tokens', 0));
        $outputTokens = max(0, $maxTokens);

        return ($inputTokens / 1000000) * (float)$rule->input_price
            + ($outputTokens / 1000000) * (float)$rule->output_price;
    }

    private function balanceTypeForBillingRule(BillingRule $rule): string
    {
        return $rule->billing_type === 'credit' ? 'credit' : 'token';
    }

    private function estimateEmbeddingCost(BillingRule $rule, $input): float
    {
        if ($rule->billing_type !== 'token') return 0;
        $inputTokens = $this->estimateTokens($input);
        return ($inputTokens / 1000000) * (float)$rule->input_price;
    }

    private function estimateTokens($payload): int
    {
        $chars = $this->inputChars($payload);
        return max(1, (int)ceil($chars / 4));
    }

    private function inputChars($payload): int
    {
        if (is_string($payload)) return max(1, mb_strlen($payload));
        if (is_array($payload)) {
            return max(1, array_sum(array_map(function ($item) {
                if (is_string($item)) return mb_strlen($item);
                return mb_strlen(json_encode($item, JSON_UNESCAPED_UNICODE));
            }, $payload)));
        }
        return 1;
    }

}
