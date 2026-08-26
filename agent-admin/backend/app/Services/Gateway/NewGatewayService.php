<?php

namespace App\Services\Gateway;

use App\Models\BillingRule;
use App\Models\CloudModel;
use App\Models\UsageRecord;
use App\Services\BalanceService;
use App\Services\QuotaService;
use App\Services\StorageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

/**
 * 网关链路：由 GatewayController 委托过来。
 *
 * 串起 GatewayRouter（适配器 + 凭证）→ CapabilityFilter（请求体清洗）→
 * Adapter（协议翻译调用上游）→ 计费 / 扣款 / UsageRecord 写入。
 *
 * 设计原则：
 *   - 计费 / 扣款 / UsageRecord 私有 helper 自包含，未来若再拆分可统一抽到 BillingHelper。
 *   - 流式响应用 echo + flush 形态（Adapter 内用 curl，Service 负责 ob_flush + flush）。
 *   - 图像调用不在本 Service 内：GatewayController 入库后 dispatch ProcessImageTaskJob，
 *     由 queue:work worker 拉取实际执行，业务逻辑放在 App\Jobs\ProcessImageTaskJob 内部。
 */
class NewGatewayService
{
    private GatewayRouter $router;
    private CapabilityFilter $filter;

    public function __construct(GatewayRouter $router, CapabilityFilter $filter)
    {
        $this->router = $router;
        $this->filter = $filter;
    }

    /**
     * chat completions 总入口（自动按 stream 派发）。
     */
    public function handleChat(Request $request, $user, CloudModel $cloudModel, ?BillingRule $billingRule, string $requestId)
    {
        $route = $this->router->route($cloudModel);

        // 转发上游前剥掉 cloud_model_id（非 OpenAI 协议字段，仅用于本网关路由）
        $body = $request->except(['_token', 'cloud_model_id']);
        $body['model'] = $cloudModel->model_id;

        $isStream = (bool) $request->input('stream', false);

        // ── 流式能力门禁 ────────────────────────────────────────
        // capabilities.stream=false 表示该 provider 不支持 SSE 流式。
        // 客户端发 stream=true 时不能"静默降级为同步响应"——OpenAI Python SDK 等
        // 流式调用方会预期 Content-Type: text/event-stream，拿到 application/json
        // 会抛 "expected SSE stream" 错误。所以这里直接 400 返回明确错误，
        // 让客户端能看到清楚原因，而不是被降级响应坑到。
        $caps = $this->filter->resolveCapabilities($route->provider);
        if ($isStream && empty($caps['stream'])) {
            return response()->json([
                'error' => [
                    'message' => '该服务商已配置为不支持流式响应（capabilities.stream=false）。请去掉 stream=true 或选择其他模型。',
                    'type'    => 'capability_disabled',
                    'code'    => 'stream_unsupported',
                ],
            ], 400);
        }

        // 流式必须强制注入 stream=true + stream_options.include_usage=true，
        // 与老 GatewayController::handleStreamChat 行为对齐：上游只有在 include_usage
        // 为 true 时才会在最后一条 chunk 里附带 usage，否则计费拿不到 token 数。
        // 后续 CapabilityFilter 会按 provider.capabilities.usage_in_stream 决定保留与否
        // —— 默认全开兜底等价老行为；老 provider 不勾此能力时也会被剥（与单独关 usage 一致）。
        if ($isStream) {
            $body['stream'] = true;
            $body['stream_options'] = array_merge(
                (array) ($body['stream_options'] ?? []),
                ['include_usage' => true]
            );
        }

        $body = $this->filter->filter($body, $route->provider);

        // 转发上游前把 messages 里 image_url 的本站 cos/oss 私有对象 URL 换成预签名可拉取 URL：
        // 云端视觉（看图 / 图生词 / 画布帧分析）的参考图经桌面端 materializeMessageImages 上传换
        // 本站 URL，与视频路径同理——URL 由上游视觉模型主动回拉，私有桶下未签名直链会 403。
        $body = $this->materializeMessageImageUrls($body);

        return $isStream
            ? $this->handleStreamChat($route, $body, $user, $cloudModel, $billingRule, $requestId)
            : $this->handleSyncChat($route, $body, $user, $cloudModel, $billingRule, $requestId);
    }

    /**
     * 转发上游前把 messages 多模态 content 里 image_url 的本站私有对象 URL 换成预签名可拉取 URL。
     *
     * 覆盖 OpenAI 多模态格式：content 为数组、其中 type=image_url 的 part。纯文本 content、
     * 已是外链 / 自定义 CDN 域名 / 内联 base64 dataURI 的 url 一律原样保留
     * （StorageService::upstreamFetchableUrl 内部判定）。
     */
    private function materializeMessageImageUrls(array $body): array
    {
        if (!is_array($body['messages'] ?? null)) {
            return $body;
        }
        foreach ($body['messages'] as &$msg) {
            if (!is_array($msg) || !is_array($msg['content'] ?? null)) {
                continue;
            }
            foreach ($msg['content'] as &$part) {
                if (is_array($part)
                    && ($part['type'] ?? '') === 'image_url'
                    && is_array($part['image_url'] ?? null)
                    && isset($part['image_url']['url'])
                    && is_string($part['image_url']['url'])) {
                    $part['image_url']['url'] = StorageService::upstreamFetchableUrl($part['image_url']['url']);
                }
            }
            unset($part);
        }
        unset($msg);
        return $body;
    }

    private function handleSyncChat(RouteResult $route, array $body, $user, CloudModel $cloudModel, ?BillingRule $billingRule, string $requestId): JsonResponse
    {
        try {
            $resp = $route->adapter->chat($body, $route->provider, $route->apiKey);
        } catch (Throwable $e) {
            $this->router->markCredentialFailure($route->credential, $e->getMessage());
            $this->recordUsage($user, $cloudModel, 'chat', 0, 0, 0, 0, 'failed', $requestId, $e->getMessage());
            return response()->json(['error' => 'Gateway error: ' . $e->getMessage()], 502);
        }

        if (!$resp->ok) {
            $this->router->markCredentialFailure($route->credential, (string) ($resp->errorMessage ?? ''));
            $this->recordUsage($user, $cloudModel, 'chat', 0, 0, 0, 0, 'failed', $requestId, (string) ($resp->errorMessage ?? ''));
            $errorBody = is_array($resp->data) ? $resp->data : ['error' => $resp->errorMessage ?? 'Upstream error'];
            return response()->json($errorBody, $resp->statusCode > 0 ? $resp->statusCode : 502);
        }

        $this->router->markCredentialSuccess($route->credential);
        $usage = $resp->usage;
        $promptTokens = (int) ($usage['prompt_tokens'] ?? 0);
        $completionTokens = (int) ($usage['completion_tokens'] ?? 0);
        $totalTokens = (int) ($usage['total_tokens'] ?? ($promptTokens + $completionTokens));

        $cost = $this->calculateChatCost($billingRule, $promptTokens, $completionTokens);
        $balanceType = $this->balanceTypeForBillingRule($billingRule);
        $deduction = app(BalanceService::class)->deduct($user, $balanceType, $cost, 'usage', "chat {$requestId}", $requestId);
        app(QuotaService::class)->consumeForType($user, 'chat', 1);
        $this->recordUsage($user, $cloudModel, 'chat', $promptTokens, $completionTokens, $totalTokens, $cost, 'success', $requestId, '', $balanceType, $deduction['source_plan_id']);

        return response()->json($resp->data ?? []);
    }

    private function handleStreamChat(RouteResult $route, array $body, $user, CloudModel $cloudModel, ?BillingRule $billingRule, string $requestId)
    {
        return response()->stream(function () use ($route, $body, $user, $cloudModel, $billingRule, $requestId) {
            $usage = [];
            $sawChunk = false;

            $onChunk = function (string $data) use (&$sawChunk) {
                $sawChunk = true;
                echo $data;
                if (ob_get_level() > 0) ob_flush();
                flush();
            };
            $onUsage = function (array $u) use (&$usage) {
                $usage = $u;
            };

            try {
                $httpCode = $route->adapter->chatStream($body, $route->provider, $route->apiKey, $onChunk, $onUsage);

                if ($httpCode >= 200 && $httpCode < 300) {
                    if (!empty($usage)) {
                        $promptTokens = (int) ($usage['prompt_tokens'] ?? 0);
                        $completionTokens = (int) ($usage['completion_tokens'] ?? 0);
                        $totalTokens = (int) ($usage['total_tokens'] ?? ($promptTokens + $completionTokens));

                        if ($totalTokens > 0) {
                            $cost = $this->calculateChatCost($billingRule, $promptTokens, $completionTokens);
                            $balanceType = $this->balanceTypeForBillingRule($billingRule);
                            $deduction = app(BalanceService::class)->deduct($user, $balanceType, $cost, 'usage', "chat {$requestId}", $requestId);
                            app(QuotaService::class)->consumeForType($user, 'chat', 1);
                            $this->recordUsage($user, $cloudModel, 'chat', $promptTokens, $completionTokens, $totalTokens, $cost, 'success', $requestId, '', $balanceType, $deduction['source_plan_id']);
                        }
                    }
                    $this->router->markCredentialSuccess($route->credential);

                    // silent-200：上游回了 2xx 却整条流空（无任何分片、无 usage）。
                    // 流式响应头在首字节发出时已固定为 200，无法再用状态码表达失败，
                    // 故向 SSE 注入明确 error 事件，让桌面端区分"上游空响应"与正常结束，
                    // 不再静默成空流被误判为"模型无响应（可能余额不足）"。
                    if (!$sawChunk) {
                        $this->emitStreamError($requestId, '上游模型未返回任何内容（可能限流或服务波动），请稍后重试或更换模型');
                        $this->recordUsage($user, $cloudModel, 'chat', 0, 0, 0, 0, 'failed', $requestId, 'Empty upstream stream (silent-200)');
                    }
                } else {
                    // 覆盖三类失败：
                    //   - httpCode=0：curl 连接失败（DNS / refused / timeout，curl_exec 不抛异常仅返回 false）
                    //   - 3xx：上游下发非预期 redirect（OpenAI 协议不会出现，但兜底）
                    //   - 4xx/5xx：上游业务级失败
                    // 三类都需要 markCredentialFailure（让坏 key 累计到阈值后自动 invalid）
                    // + 写一条 failed UsageRecord（让前端用量列表能看到失败痕迹）。
                    $reason = $httpCode === 0 ? 'Stream connection failed (curl)' : "HTTP {$httpCode}";
                    $this->router->markCredentialFailure($route->credential, $reason);
                    $this->recordUsage($user, $cloudModel, 'chat', 0, 0, 0, 0, 'failed', $requestId, $reason);
                    // 流式 HTTP 状态已 200 发出，上游失败原因只能以 SSE error 事件注入流内，
                    // 否则客户端只见空流→误判为"模型无响应"。即便 curl 已把上游非 SSE 错误体写出，
                    // 桌面端 SSE 解析也只认 data: 行、无法识别，故统一补发一条标准 error 事件。
                    $this->emitStreamError($requestId, $this->friendlyUpstreamError($httpCode));
                }
            } catch (Throwable $e) {
                $this->router->markCredentialFailure($route->credential, $e->getMessage());
                $this->recordUsage($user, $cloudModel, 'chat', 0, 0, 0, 0, 'failed', $requestId, $e->getMessage());
                $this->emitStreamError($requestId, '网关转发上游时出错，请稍后重试');
            }
        }, 200, [
            'Content-Type'      => 'text/event-stream',
            'Cache-Control'     => 'no-cache',
            'Connection'        => 'keep-alive',
            'X-Accel-Buffering' => 'no',
        ]);
    }

    /**
     * 向已开启的 SSE 流注入一条标准 error 事件 + [DONE]，让桌面端能解析出精确错误。
     * 流式响应的 HTTP 状态在首字节发出时已固定为 200，无法再用状态码表达失败，
     * 故约定用 data: {"error":{...}} 事件承载上游失败原因（OpenAI 流式错误的通行做法）。
     */
    private function emitStreamError(string $requestId, string $message): void
    {
        $payload = json_encode([
            'error'      => ['message' => $message, 'type' => 'upstream_error'],
            'request_id' => $requestId,
        ], JSON_UNESCAPED_UNICODE);
        echo "data: {$payload}\n\n";
        echo "data: [DONE]\n\n";
        if (ob_get_level() > 0) ob_flush();
        flush();
    }

    /**
     * 上游 HTTP 状态码 → 中文友好提示（用于流式 error 事件文案）。
     */
    private function friendlyUpstreamError(int $httpCode): string
    {
        return match (true) {
            $httpCode === 0   => '连接上游模型失败，请稍后重试',
            $httpCode === 429 => '上游模型请求过于频繁（限流），请稍后重试',
            $httpCode === 401 || $httpCode === 403 => '上游模型鉴权失败，请联系管理员检查服务商配置',
            $httpCode >= 500  => '上游模型服务暂时不可用，请稍后重试或更换模型',
            default           => "上游模型返回错误（HTTP {$httpCode}），请稍后重试",
        };
    }

    /**
     * embeddings 入口。
     */
    public function handleEmbeddings(Request $request, $user, CloudModel $cloudModel, ?BillingRule $billingRule, string $requestId): JsonResponse
    {
        $route = $this->router->route($cloudModel);

        // 转发上游前剥掉 cloud_model_id（非 OpenAI 协议字段，仅用于本网关路由）
        $body = $request->except(['_token', 'cloud_model_id']);
        $body['model'] = $cloudModel->model_id;

        try {
            $resp = $route->adapter->embeddings($body, $route->provider, $route->apiKey);
        } catch (Throwable $e) {
            $this->router->markCredentialFailure($route->credential, $e->getMessage());
            $this->recordUsage($user, $cloudModel, 'embedding', 0, 0, 0, 0, 'failed', $requestId, $e->getMessage());
            return response()->json(['error' => 'Gateway error: ' . $e->getMessage()], 502);
        }

        if (!$resp->ok) {
            $this->router->markCredentialFailure($route->credential, (string) ($resp->errorMessage ?? ''));
            $this->recordUsage($user, $cloudModel, 'embedding', 0, 0, 0, 0, 'failed', $requestId);
            $errorBody = is_array($resp->data) ? $resp->data : ['error' => $resp->errorMessage ?? 'Upstream error'];
            return response()->json($errorBody, $resp->statusCode > 0 ? $resp->statusCode : 502);
        }

        $this->router->markCredentialSuccess($route->credential);
        $usage = $resp->usage;
        $totalTokens = (int) ($usage['total_tokens'] ?? 0);

        $cost = $this->calculateTokenCost($billingRule, $totalTokens, 0);
        $deduction = app(BalanceService::class)->deduct($user, 'token', $cost, 'usage', "embedding {$requestId}", $requestId);
        app(QuotaService::class)->consumeForType($user, 'embedding', $this->inputChars($body['input'] ?? ''));
        $this->recordUsage($user, $cloudModel, 'embedding', $totalTokens, 0, $totalTokens, $cost, 'success', $requestId, '', 'token', $deduction['source_plan_id']);

        return response()->json($resp->data ?? []);
    }

    // ========== Billing helpers（与 GatewayController 同步，保持新老路径字段级一致） ==========

    private function calculateTokenCost(?BillingRule $rule, int $promptTokens, int $completionTokens): float
    {
        if (!$rule || $rule->billing_type !== 'token') return 0;

        return ($promptTokens / 1000000) * (float) $rule->input_price
             + ($completionTokens / 1000000) * (float) $rule->output_price;
    }

    private function calculateChatCost(?BillingRule $rule, int $promptTokens, int $completionTokens): float
    {
        if (!$rule || !in_array($rule->billing_type, ['token', 'credit'], true)) return 0;

        return ($promptTokens / 1000000) * (float) $rule->input_price
             + ($completionTokens / 1000000) * (float) $rule->output_price;
    }

    private function balanceTypeForBillingRule(?BillingRule $rule): string
    {
        return $rule && $rule->billing_type === 'credit' ? 'credit' : 'token';
    }

    private function inputChars($input): int
    {
        if (is_string($input)) return max(1, mb_strlen($input));
        if (is_array($input)) return max(1, array_sum(array_map(fn($item) => is_string($item) ? mb_strlen($item) : mb_strlen(json_encode($item, JSON_UNESCAPED_UNICODE)), $input)));
        return 1;
    }

    private function recordUsage($user, $cloudModel, string $type, int $promptTokens, int $completionTokens, int $totalTokens, float $cost, string $status, string $requestId, string $remark = '', string $balanceType = 'token', ?int $sourcePlanId = null): void
    {
        UsageRecord::create([
            'user_id'           => $user->id,
            'cloud_model_id'    => $cloudModel->id,
            'type'              => $type,
            'prompt_tokens'     => $promptTokens,
            'completion_tokens' => $completionTokens,
            'total_tokens'      => $totalTokens,
            'credits_used'      => $balanceType === 'credit' ? $cost : 0,
            'cost'              => $cost,
            'balance_type'      => $balanceType,
            'source_plan_id'    => $sourcePlanId,
            'status'            => $status,
            'request_id'        => $requestId,
            'remark'            => $remark,
        ]);
    }
}
