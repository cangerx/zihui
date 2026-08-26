<?php

namespace App\Services\Gateway\Adapters;

use App\Models\CloudProvider;
use App\Services\Gateway\Contracts\ProbeResult;
use App\Services\Gateway\Contracts\UpstreamResponse;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * OpenAI 协议兼容适配器：覆盖 OpenAI 官方 + 一切自称"OpenAI 兼容"的服务商
 * （DeepSeek / Kimi / 智谱 / 通义千问 OpenAI 模式 / SiliconFlow / OpenRouter / Groq /
 * 中转 API / 自建 vLLM / Ollama / LiteLLM 等）。
 *
 * 协议特征：
 *   - 路径：/v1/models、/v1/chat/completions、/v1/embeddings、/v1/images/{generations|edits}
 *   - 鉴权：Bearer（默认）；Azure 风格 api-key 头由 AbstractAdapter::buildHttp 切换
 *   - 请求/响应体：原 OpenAI JSON 形态
 *   - 流式：SSE（data: {chunk}\n\n）
 *
 * 实现策略：
 *   - chat / embeddings / image 走 Laravel HTTP Client（透传上游 JSON）
 *   - chat 流式必须保留 GatewayController::handleStreamChat 的原生 curl + 边收边吐实现，
 *     不能换成 Guzzle Stream（缓冲行为会变，影响首 token 时间与心跳）
 *   - 探测复用并扩展 ProviderProbe 的逻辑，但允许走 buildHttp（拿到 config 里的 SSL/proxy/header 等）
 *
 * 行为兼容性保证：当 provider.config 为 null（老 provider）时，buildHttp 退化为
 *   "Http::withToken($apiKey)->timeout($timeout)" 的等价形态，与原 GatewayController
 *   的请求形态字段级一致。
 */
class OpenAICompatibleAdapter extends AbstractAdapter
{
    /**
     * @inheritDoc
     */
    public function chat(array $body, CloudProvider $provider, string $apiKey): UpstreamResponse
    {
        $url = $this->applyQuery($this->buildUrl($provider, 'chat/completions'), $provider, $apiKey);
        $timeout = (int) config('gateway.timeouts.chat', 180);

        try {
            $response = $this->buildHttp($provider, $apiKey, $timeout)->post($url, $body);
            $code = $response->status();
            $data = $response->json();

            if (!$response->successful()) {
                return UpstreamResponse::fail(
                    $code,
                    is_array($data) ? $data : null,
                    'Upstream error (HTTP ' . $code . ')' . $this->summarizeErrorBody((string) $response->body())
                );
            }

            $data = is_array($data) ? $data : [];
            return UpstreamResponse::ok($code, $data, $this->extractUsage($data));
        } catch (ConnectionException $e) {
            return UpstreamResponse::fail(0, null, $this->classifyConnectionError($e->getMessage()));
        } catch (Throwable $e) {
            Log::warning("[adapter.openai_compat.chat] provider={$provider->id} err=" . $e->getMessage());
            return UpstreamResponse::fail(0, null, 'Gateway error: ' . $e->getMessage());
        }
    }

    /**
     * 流式 chat：1:1 复用 GatewayController::handleStreamChat 的原生 curl 实现，
     * 仅替换鉴权与可选配置（auth_style / extra_headers / verify_ssl / proxy）的施加方式。
     *
     * usage 解析逻辑保持原样：扫描每个 SSE chunk 里的 `data: {...}`，遇到 usage 字段则更新。
     * OpenAI 与多数兼容服务在末尾发一个带 usage 的特殊 chunk（启用 stream_options.include_usage 时）。
     *
     * @inheritDoc
     */
    public function chatStream(
        array $body,
        CloudProvider $provider,
        string $apiKey,
        callable $onChunk,
        callable $onUsage
    ): int {
        $url = $this->applyQuery($this->buildUrl($provider, 'chat/completions'), $provider, $apiKey);
        $timeout = (int) config('gateway.timeouts.chat', 180);

        $headers = $this->buildCurlHeaders($provider, $apiKey, true);

        $promptTokens = 0;
        $completionTokens = 0;
        $totalTokens = 0;

        $ch = curl_init($url);

        $writeFunction = function ($ch, $data) use ($onChunk, &$promptTokens, &$completionTokens, &$totalTokens) {
            // 透传给上层（NewGatewayService 负责 echo + flush，行为与老 handleStreamChat 一致）
            $onChunk($data);

            // 顺手解析 usage（与老代码 GatewayController:271-283 行为一致）
            $lines = explode("\n", $data);
            foreach ($lines as $line) {
                if (strpos($line, 'data: ') === 0) {
                    $json = substr($line, 6);
                    if ($json === '[DONE]') continue;
                    $parsed = json_decode($json, true);
                    if (isset($parsed['usage']) && is_array($parsed['usage'])) {
                        $promptTokens = $parsed['usage']['prompt_tokens'] ?? $promptTokens;
                        $completionTokens = $parsed['usage']['completion_tokens'] ?? $completionTokens;
                        $totalTokens = $parsed['usage']['total_tokens'] ?? $totalTokens;
                    }
                }
            }

            return strlen($data);
        };

        $opts = [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode($body),
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_WRITEFUNCTION  => $writeFunction,
        ];

        $config = $this->config($provider);
        if (($config['verify_ssl'] ?? true) === false) {
            $opts[CURLOPT_SSL_VERIFYPEER] = false;
            $opts[CURLOPT_SSL_VERIFYHOST] = 0;
        }
        if (!empty($config['proxy'])) {
            $opts[CURLOPT_PROXY] = $config['proxy'];
        }

        curl_setopt_array($ch, $opts);
        curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($promptTokens > 0 || $completionTokens > 0 || $totalTokens > 0) {
            $onUsage([
                'prompt_tokens'     => (int) $promptTokens,
                'completion_tokens' => (int) $completionTokens,
                'total_tokens'      => (int) ($totalTokens ?: ($promptTokens + $completionTokens)),
            ]);
        }

        return $httpCode;
    }

    /**
     * @inheritDoc
     */
    public function embeddings(array $body, CloudProvider $provider, string $apiKey): UpstreamResponse
    {
        $url = $this->applyQuery($this->buildUrl($provider, 'embeddings'), $provider, $apiKey);
        $timeout = (int) config('gateway.timeouts.embeddings', 60);

        try {
            $response = $this->buildHttp($provider, $apiKey, $timeout)->post($url, $body);
            $code = $response->status();
            $data = $response->json();

            if (!$response->successful()) {
                return UpstreamResponse::fail(
                    $code,
                    is_array($data) ? $data : null,
                    'Upstream error (HTTP ' . $code . ')' . $this->summarizeErrorBody((string) $response->body())
                );
            }

            $data = is_array($data) ? $data : [];
            // embeddings 的 usage 只有 total_tokens（无 completion_tokens 概念）
            $usage = [];
            if (isset($data['usage']['total_tokens'])) {
                $usage = [
                    'prompt_tokens'     => (int) ($data['usage']['prompt_tokens'] ?? $data['usage']['total_tokens']),
                    'completion_tokens' => 0,
                    'total_tokens'      => (int) $data['usage']['total_tokens'],
                ];
            }
            return UpstreamResponse::ok($code, $data, $usage);
        } catch (ConnectionException $e) {
            return UpstreamResponse::fail(0, null, $this->classifyConnectionError($e->getMessage()));
        } catch (Throwable $e) {
            Log::warning("[adapter.openai_compat.embeddings] provider={$provider->id} err=" . $e->getMessage());
            return UpstreamResponse::fail(0, null, 'Gateway error: ' . $e->getMessage());
        }
    }

    /**
     * @inheritDoc
     *
     * 'edits' 端点且 body['images'] 非空时 → multipart；其他 → JSON post。
     *
     * body 白名单清洗：
     *   GatewayController 仅剥 _token / cloud_model_id；其他网关私有字段（前端调试残留、
     *   未来可能新增的内部字段）裸传给上游会触发部分 OpenAI 兼容服务的 WAF 严格校验，
     *   返回 HTML 400。这里按 OpenAI 官方协议字段严格白名单，仅保留协议声明字段。
     *   厂商扩展字段（seed / guidance_scale / negative_prompt 等）在白名单内，保持兼容性。
     */
    public function image(string $endpoint, array $body, CloudProvider $provider, string $apiKey): UpstreamResponse
    {
        $url = $this->applyQuery($this->buildUrl($provider, 'images/' . $endpoint), $provider, $apiKey);
        $totalTimeout = (int) config('gateway.timeouts.image', 900);

        $body = $this->cleanseImageBody($body);

        // 内联 1 次重试：覆盖瞬时网络抖动 + 上游 5xx/429，避免每次抖动都升级到 Job 层 30s 退避。
        // 触发条件严格：429 / 500-504 / 524 / ConnectionException；4xx 业务错误立即抛出不重试。
        //
        // **共享 deadline**：两次 attempt 共享同一份 totalTimeout budget。每次 HTTP timeout
        // 取剩余 budget，保证总耗时 ≤ totalTimeout，不会出现"两次都跑满 900s = 1800s"撞
        // Job::$timeout(960s) 的窘境。第一次撞 timeout 后 budget ≈ 0，自动放弃重试。
        $maxAttempts = 2;
        $deadline = microtime(true) + $totalTimeout;
        $lastFail = null;

        for ($attempt = 0; $attempt < $maxAttempts; $attempt++) {
            $remaining = (int) max(1, ceil($deadline - microtime(true)));
            // budget 已耗光，无需再试；返回上一次失败结果
            if ($remaining <= 1 && $attempt > 0) {
                return $lastFail ?? UpstreamResponse::fail(0, null, 'Image timeout (deadline reached)');
            }

            try {
                if ($endpoint === 'edits' && !empty($body['images']) && is_array($body['images'])) {
                    $response = $this->postImageMultipart($url, $body, $provider, $apiKey, $remaining);
                } else {
                    $response = $this->buildHttp($provider, $apiKey, $remaining)->post($url, $body);
                }

                $code = $response->status();
                $data = $response->json();

                if ($response->successful()) {
                    return UpstreamResponse::ok($code, is_array($data) ? $data : [], []);
                }

                $errorMsg = 'Upstream error (HTTP ' . $code . ')' . $this->summarizeErrorBody((string) $response->body());
                $failResp = UpstreamResponse::fail($code, is_array($data) ? $data : null, $errorMsg);

                // 4xx（除 429）业务错误 / 最后一次重试用完：直接返回 fail
                if (!$this->isRetriableImageStatus($code) || $attempt >= $maxAttempts - 1) {
                    return $failResp;
                }

                Log::info("[adapter.openai_compat.image] retry attempt=" . ($attempt + 1) . " status={$code} provider={$provider->id} endpoint={$endpoint} budget_left={$remaining}s");
                $lastFail = $failResp;
            } catch (ConnectionException $e) {
                $failResp = UpstreamResponse::fail(0, null, $this->classifyConnectionError($e->getMessage()));
                if ($attempt >= $maxAttempts - 1) {
                    return $failResp;
                }
                Log::info("[adapter.openai_compat.image] retry attempt=" . ($attempt + 1) . " conn_err=" . $e->getMessage() . " provider={$provider->id} endpoint={$endpoint} budget_left={$remaining}s");
                $lastFail = $failResp;
            } catch (Throwable $e) {
                // 未知 Throwable 不重试（代码 bug 类，重试结果一样）
                Log::warning("[adapter.openai_compat.image] provider={$provider->id} endpoint={$endpoint} err=" . $e->getMessage());
                return UpstreamResponse::fail(0, null, 'Gateway error: ' . $e->getMessage());
            }

            usleep(500_000); // 500ms 短退避，next iteration 重试
        }

        // 理论不可达（每个分支都 return），兜底
        return $lastFail ?? UpstreamResponse::fail(0, null, 'Image retry exhausted');
    }

    /**
     * image() 内联重试触发条件：429 限流 + 500-504 上游故障 + 524 Cloudflare 网关。
     * 其他 4xx / 5xx 视为终态（业务错误 / 协议错误），重试无意义。
     */
    private function isRetriableImageStatus(int $code): bool
    {
        return $code === 429 || $code === 524 || ($code >= 500 && $code <= 504);
    }

    /**
     * OpenAI 图片接口 body 白名单清洗。
     *
     * 协议字段（OpenAI 官方 + 主流兼容服务商扩展）：
     *   - 通用：model / prompt / n / size / quality / response_format / style / user
     *   - gpt-image-1 系列：background / moderation / output_compression / output_format /
     *                       partial_images / stream
     *   - 厂商扩展（保留兼容性）：seed / guidance / guidance_scale /
     *                              num_inference_steps / negative_prompt
     *   - edits 端点专用：image / images / mask
     *
     * 不在白名单的字段（cloud_model_id / 调试字段 / 未来网关私有字段）一律剥除。
     * 多米由 DuoMiAdapter 自带 cleanseDuoMiBody（更严格 enum 校验），不走此路径。
     */
    private function cleanseImageBody(array $body): array
    {
        $allowed = [
            'model', 'prompt', 'n', 'size', 'quality', 'response_format',
            'style', 'user',
            'background', 'moderation', 'output_compression', 'output_format',
            'partial_images', 'stream',
            'seed', 'guidance', 'guidance_scale', 'num_inference_steps',
            'negative_prompt',
            'image', 'images', 'mask',
        ];
        $out = [];
        foreach ($allowed as $key) {
            if (array_key_exists($key, $body)) {
                $out[$key] = $body[$key];
            }
        }
        $model = is_string($out['model'] ?? null) ? (string) $out['model'] : '';
        if (preg_match('/^(gpt-image(?:-|$)|chatgpt-image-latest$)/i', $model)) {
            unset($out['response_format']);
        }
        return $out;
    }

    /**
     * 图像编辑 multipart 上传：用 `buildHttp` 让 auth_style / extra_headers /
     * verify_ssl / proxy 等 config 能生效。
     *
     * **multipart 专用 cURL 调优**（multipart 上传通用最佳实践）：
     *
     *   1. FORBID_REUSE=1：本次请求结束后关闭连接（不进 keep-alive 池），避免后续请求
     *      复用到对端已关闭的死连接
     *
     *   2. FRESH_CONNECT=1：本次请求一律开新连接，不从 keep-alive 池里拿。配合 1 形成
     *      "一连接一上传"模型，避免"复用死连接 → cURL 内部 retry → 需要 rewind multipart
     *      body → Guzzle MultipartStream SEEKFUNCTION 失败（PHP bug #47204）"链
     *
     *   3. Expect 空头：禁用 cURL 默认 Expect: 100-continue（大 body 时上游若不响应 100
     *      会等 1s 才发 body，且部分中转 API 完全不支持 Expect 协商）
     *
     * 备注：HTTP/2 强制曾在 buildHttp 中存在（为排查 gpt-image-2 4K 退化 1K 问题），
     *       但触发了 multipart + HTTP/2 stream 控制 retry 导致本接口大面积失败，已移除。
     *       cURL 默认走 HTTP/1.1，本方法不再需要显式覆盖协议版本。
     */
    private function postImageMultipart(
        string $url,
        array $body,
        CloudProvider $provider,
        string $apiKey,
        int $timeout
    ) {
        $images = $body['images'];
        $mask = $body['mask'] ?? null;
        unset($body['images'], $body['mask']);

        $http = $this->buildHttp($provider, $apiKey, $timeout);

        // multipart 专用 cURL 调优（关 keep-alive 复用 + 关 Expect 协商）
        $http = $http->withOptions([
            'curl' => [
                \CURLOPT_FORBID_REUSE => 1,
                \CURLOPT_FRESH_CONNECT => 1,
            ],
        ])->withHeaders([
            'Expect' => '',
        ]);

        foreach ($body as $key => $value) {
            if (is_array($value)) continue;
            $http = $http->attach($key, (string) $value);
        }

        foreach ($images as $i => $base64) {
            $binary = base64_decode($base64);
            $http = $http->attach('image', $binary, "ref_{$i}.png");
        }

        if ($mask) {
            $maskBinary = base64_decode($mask);
            $http = $http->attach('mask', $maskBinary, 'mask.png');
        }

        return $http->post($url);
    }

    /**
     * @inheritDoc
     *
     * 1:1 复用 ProviderProbe::probeModels 的判定与文案。差异仅在 HTTP 客户端构造：
     * 走 buildHttp 让 config 生效（老 provider config=null 时退化为等价老行为）。
     */
    public function probeModels(CloudProvider $provider, string $apiKey, int $timeoutSeconds = 15): ProbeResult
    {
        if (empty($provider->api_base)) {
            return ProbeResult::error('请先填写 API 地址', null, '');
        }
        if (empty($apiKey)) {
            return ProbeResult::error('请先填写 API 密钥', null, '');
        }

        $url = $this->applyQuery($this->buildUrl($provider, 'models'), $provider, $apiKey);

        try {
            $response = $this->buildHttp($provider, $apiKey, $timeoutSeconds)->get($url);
            $code = $response->status();

            if ($response->successful()) {
                $body = $response->json();
                if (!is_array($body) || !isset($body['data']) || !is_array($body['data'])) {
                    return ProbeResult::warning(
                        "地址返回 HTTP {$code}，但响应不是 OpenAI 协议（缺少 data 数组）。"
                            . '常见原因：填写的不是 API 地址而是网站首页，或上游协议不兼容。',
                        $code,
                        $url,
                        []
                    );
                }
                $modelCount = count($body['data']);
                return ProbeResult::ok(
                    "连接成功（HTTP {$code}），发现 {$modelCount} 个可用模型",
                    $code,
                    $url,
                    $body['data']
                );
            }

            if ($code === 403) {
                return ProbeResult::warning(
                    'API 地址可达，但 /models 端点被上游拒绝（HTTP 403）。'
                        . '常见于中转 API 对 /models 做白名单拦截，不影响 /chat/completions 实际调用，可继续使用。',
                    403,
                    $url
                );
            }

            if ($code === 401) {
                return ProbeResult::error('连接到服务器但鉴权失败（HTTP 401）：请检查 API Key 是否正确', 401, $url);
            }
            if ($code === 404) {
                return ProbeResult::error(
                    '地址不存在（HTTP 404）：请检查 API 基础地址是否正确（例如是否缺少 /v1 版本段）',
                    404,
                    $url
                );
            }
            if ($code >= 500) {
                return ProbeResult::error("上游服务器异常（HTTP {$code}），可稍后重试", $code, $url);
            }
            return ProbeResult::error("连接异常（HTTP {$code}）", $code, $url);
        } catch (ConnectionException $e) {
            return ProbeResult::error(
                '无法连接：' . $this->classifyConnectionError($e->getMessage()),
                null,
                $url
            );
        } catch (Throwable $e) {
            Log::warning("[adapter.openai_compat.probe_models] provider={$provider->id} err=" . $e->getMessage());
            return ProbeResult::error('请求异常：' . $e->getMessage(), null, $url);
        }
    }

    /**
     * @inheritDoc
     *
     * 1:1 复用 ProviderProbe::probeChat 的 max_tokens=1 + temperature=0 + stream=false 形态。
     * CapabilityFilter 不会作用在探测路径上（探测必须用最朴素请求体来验证连通性，
     * 不被能力清单干扰）。如果 provider.capabilities.reasoning_params=true，
     * 上层 ProbeService 会改写本方法的请求体（详见 task 9 ProbeService 设计）。
     */
    public function probeChat(CloudProvider $provider, string $apiKey, ?string $modelId = null, ?int $timeoutSeconds = null): ProbeResult
    {
        // 未传 timeout 时回落 config('gateway.timeouts.deep_probe')；与 ProviderProbe 行为一致。
        $timeoutSeconds = $timeoutSeconds ?? (int) config('gateway.timeouts.deep_probe', 20);
        if (empty($provider->api_base)) {
            return ProbeResult::error('请先填写 API 地址', null, '');
        }
        if (empty($apiKey)) {
            return ProbeResult::error('请先填写 API 密钥', null, '');
        }

        if (!$modelId) {
            $modelsResult = $this->probeModels($provider, $apiKey, 15);
            if ($modelsResult->status === 'error') {
                return ProbeResult::error(
                    '深度测试无法获取可用模型列表：' . $modelsResult->message,
                    $modelsResult->httpStatus,
                    $modelsResult->endpoint ?? ''
                );
            }
            $list = $modelsResult->models;
            if (empty($list)) {
                return ProbeResult::error(
                    '该服务商 /models 端点不返回模型列表（可能被白名单拦截或不规范），无法自动选择 model。请前往「拉取模型」手动确认或指定具体 model 进行深度测试。',
                    null,
                    $modelsResult->endpoint ?? ''
                );
            }
            $modelId = $list[0]['id'] ?? null;
            if (!$modelId) {
                return ProbeResult::error('返回的模型列表条目缺少 id 字段，协议不规范', null, $modelsResult->endpoint ?? '');
            }
        }

        $url = $this->applyQuery($this->buildUrl($provider, 'chat/completions'), $provider, $apiKey);

        try {
            $response = $this->buildHttp($provider, $apiKey, $timeoutSeconds)->post($url, [
                'model'       => $modelId,
                'messages'    => [['role' => 'user', 'content' => 'ping']],
                'max_tokens'  => 1,
                'temperature' => 0,
                'stream'      => false,
            ]);

            $code = $response->status();

            if ($response->successful()) {
                $body = $response->json();
                $hasChoices = is_array($body) && isset($body['choices']) && is_array($body['choices']) && count($body['choices']) > 0;
                if (!$hasChoices) {
                    return new ProbeResult(
                        'warning',
                        "chat 接口返回 HTTP {$code}，但响应缺少 choices 字段，协议不规范（model={$modelId}）",
                        $code,
                        $url,
                        [],
                        $modelId
                    );
                }
                return new ProbeResult(
                    'ok',
                    "深度测试通过：/chat/completions 调用成功（model={$modelId}，仅消耗 1 token）",
                    $code,
                    $url,
                    [],
                    $modelId
                );
            }

            $bodySummary = $this->summarizeErrorBody((string) $response->body());
            $hint = match (true) {
                $code === 401 => 'API Key 无效或被吊销',
                $code === 402 => '账户余额不足',
                $code === 403 => '此 model 对当前 Key 不开放',
                $code === 404 => "model={$modelId} 在此服务商不存在，或地址错",
                $code === 429 => '触发限流，可稍后重试',
                $code >= 500 => '上游服务器异常',
                default       => '请求被拒绝',
            };

            return ProbeResult::error(
                "深度测试失败：HTTP {$code}，{$hint}{$bodySummary}",
                $code,
                $url
            );
        } catch (ConnectionException $e) {
            return ProbeResult::error(
                "深度测试无法连接（model={$modelId}）：" . $this->classifyConnectionError($e->getMessage()),
                null,
                $url
            );
        } catch (Throwable $e) {
            Log::warning("[adapter.openai_compat.probe_chat] provider={$provider->id} model={$modelId} err=" . $e->getMessage());
            return ProbeResult::error('深度测试异常：' . $e->getMessage(), null, $url);
        }
    }

    /**
     * 把 buildHttp 的语义翻译成 curl HTTPHEADER 数组（流式调用必须走原生 curl，
     * 不能复用 PendingRequest）。
     *
     * @param bool $forStream true 时增加 'Accept: text/event-stream'
     */
    private function buildCurlHeaders(CloudProvider $provider, string $apiKey, bool $forStream): array
    {
        $config = $this->config($provider);
        $authStyle = $config['auth_style'] ?? 'bearer';

        $headers = ['Content-Type: application/json'];
        if ($forStream) {
            $headers[] = 'Accept: text/event-stream';
        }

        if ($authStyle === 'bearer') {
            $headers[] = 'Authorization: Bearer ' . $apiKey;
        } elseif ($authStyle === 'azure_api_key') {
            $headers[] = 'api-key: ' . $apiKey;
        }
        // auth_style=query 时由 applyQuery 把 api_key 拼到 URL，header 不放鉴权

        $extra = $config['extra_headers'] ?? [];
        if (is_array($extra)) {
            foreach ($extra as $k => $v) {
                if (is_string($k) && (is_string($v) || is_numeric($v))) {
                    $headers[] = $k . ': ' . $v;
                }
            }
        }

        return $headers;
    }
}
