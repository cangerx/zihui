<?php

namespace App\Services\Provider;

use App\Models\CloudProvider;
use App\Support\ApiBase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * 服务商连通性探测器。
 *
 * 抽出原 CloudProviderController::testConnection / fetchModels 的共用逻辑：
 *   - 基础探测 probeModels()：GET /models（网络 + 鉴权 + 协议格式 + 模型清单）
 *   - 深度探测 probeChat()：POST /chat/completions（实际可用性，max_tokens=1，仅消耗 1 token）
 *
 * 返回结构统一为：
 *   [
 *     'status'      => 'ok' | 'warning' | 'error',
 *     'message'     => 人话提示,
 *     'http_status' => int|null,
 *     'endpoint'    => string,
 *     'models'      => list<array>|null  (probeModels 命中 OpenAI 协议时附带，供 fetchModels / probeChat 复用)
 *     'model'       => string|null       (probeChat 用到的具体模型 id)
 *   ]
 *
 * Controller 决定 HTTP 状态码（ok/warning → 200，error → 400）。
 */
class ProviderProbe
{
    /**
     * 探测 GET /models：网络可达 + 鉴权 + 协议格式校验。
     *
     * 设计要点：
     *   - 200 也要校验是否符合 OpenAI 协议（有 data 数组）；
     *     防止用户把 api_base 误填成网站首页（返回 200 HTML）也被判为通过
     *   - 403 视为 warning（中转 API 对 /models 做白名单拦截，不影响 /chat/completions）
     *   - ConnectionException 细分 timeout / DNS / SSL / refused，给具体修复建议
     */
    public function probeModels(CloudProvider $provider, int $timeoutSeconds = 15): array
    {
        if (empty($provider->api_base)) {
            return $this->error('请先填写 API 地址', null, '');
        }
        if (empty($provider->api_key)) {
            return $this->error('请先填写 API 密钥', null, '');
        }

        $url = ApiBase::normalize($provider->api_base) . '/models';

        try {
            $response = Http::withToken($provider->api_key)->timeout($timeoutSeconds)->get($url);
            $code = $response->status();

            // 2xx：HTTP 层成功，再验返回是否符合 OpenAI 协议
            if ($response->successful()) {
                $body = $response->json();
                if (!is_array($body) || !isset($body['data']) || !is_array($body['data'])) {
                    return [
                        'status'      => 'warning',
                        'message'     => "地址返回 HTTP {$code}，但响应不是 OpenAI 协议（缺少 data 数组）。"
                            . '常见原因：填写的不是 API 地址而是网站首页，或上游协议不兼容。',
                        'http_status' => $code,
                        'endpoint'    => $url,
                        'models'      => [],
                    ];
                }
                $modelCount = count($body['data']);
                return [
                    'status'      => 'ok',
                    'message'     => "连接成功（HTTP {$code}），发现 {$modelCount} 个可用模型",
                    'http_status' => $code,
                    'endpoint'    => $url,
                    'models'      => $body['data'],
                ];
            }

            // 403：地址可达但端点白名单拦截（中转 API 常见）
            if ($code === 403) {
                return [
                    'status'      => 'warning',
                    'message'     => 'API 地址可达，但 /models 端点被上游拒绝（HTTP 403）。'
                        . '常见于中转 API 对 /models 做白名单拦截，不影响 /chat/completions 实际调用，可继续使用。',
                    'http_status' => 403,
                    'endpoint'    => $url,
                ];
            }

            if ($code === 401) {
                return $this->error('连接到服务器但鉴权失败（HTTP 401）：请检查 API Key 是否正确', 401, $url);
            }
            if ($code === 404) {
                return $this->error(
                    '地址不存在（HTTP 404）：请检查 API 基础地址是否正确（例如是否缺少 /v1 版本段）',
                    404,
                    $url
                );
            }
            if ($code >= 500) {
                return $this->error("上游服务器异常（HTTP {$code}），可稍后重试", $code, $url);
            }
            return $this->error("连接异常（HTTP {$code}）", $code, $url);
        } catch (ConnectionException $e) {
            return $this->error(
                '无法连接：' . $this->classifyConnectionError($e->getMessage()),
                null,
                $url
            );
        } catch (Throwable $e) {
            Log::warning("[provider.probe] id={$provider->id} err=" . $e->getMessage());
            return $this->error('请求异常：' . $e->getMessage(), null, $url);
        }
    }

    /**
     * 深度探测：发一条 max_tokens=1 的 chat completion，验证 /chat/completions 真正可用。
     *
     * 解决 probeModels 的盲区：/models 通不代表 chat 通（中转 API 经常 /models 200 但 chat 502）。
     * 代价：消耗 1 个 token（成本忽略不计）。
     *
     * 自动选 model：未指定 modelId 时先 probeModels() 拿第一个 data[].id。
     * 失败兜底：probeModels 失败 / data 为空 → 返回 error，要求用户手动指定 model。
     *
     * 超时：未传 $timeoutSeconds 时回落到 config('gateway.timeouts.deep_probe')，
     * 默认 20s（与 GATEWAY_TIMEOUT_DEEP_PROBE 环境变量打通）。PHP 函数默认值不能写
     * config() 调用，所以这里用 null 标记"未传入"。
     */
    public function probeChat(CloudProvider $provider, ?string $modelId = null, ?int $timeoutSeconds = null): array
    {
        $timeoutSeconds = $timeoutSeconds ?? (int) config('gateway.timeouts.deep_probe', 20);
        if (empty($provider->api_base)) {
            return $this->error('请先填写 API 地址', null, '');
        }
        if (empty($provider->api_key)) {
            return $this->error('请先填写 API 密钥', null, '');
        }

        // 自动选择 model
        if (!$modelId) {
            $modelsResult = $this->probeModels($provider, 15);
            if ($modelsResult['status'] === 'error') {
                return $this->error(
                    '深度测试无法获取可用模型列表：' . $modelsResult['message'],
                    $modelsResult['http_status'] ?? null,
                    $modelsResult['endpoint'] ?? ''
                );
            }
            $list = $modelsResult['models'] ?? [];
            if (empty($list)) {
                return $this->error(
                    '该服务商 /models 端点不返回模型列表（可能被白名单拦截或不规范），无法自动选择 model。请前往「拉取模型」手动确认或指定具体 model 进行深度测试。',
                    null,
                    $modelsResult['endpoint'] ?? ''
                );
            }
            $modelId = $list[0]['id'] ?? null;
            if (!$modelId) {
                return $this->error('返回的模型列表条目缺少 id 字段，协议不规范', null, $modelsResult['endpoint'] ?? '');
            }
        }

        $url = ApiBase::normalize($provider->api_base) . '/chat/completions';

        try {
            $response = Http::withToken($provider->api_key)
                ->timeout($timeoutSeconds)
                ->post($url, [
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
                    return [
                        'status'      => 'warning',
                        'message'     => "chat 接口返回 HTTP {$code}，但响应缺少 choices 字段，协议不规范（model={$modelId}）",
                        'http_status' => $code,
                        'endpoint'    => $url,
                        'model'       => $modelId,
                    ];
                }
                return [
                    'status'      => 'ok',
                    'message'     => "深度测试通过：/chat/completions 调用成功（model={$modelId}，仅消耗 1 token）",
                    'http_status' => $code,
                    'endpoint'    => $url,
                    'model'       => $modelId,
                ];
            }

            $bodySummary = $this->summarizeErrorBody($response->body());
            $hint = match (true) {
                $code === 401 => 'API Key 无效或被吊销',
                $code === 402 => '账户余额不足',
                $code === 403 => '此 model 对当前 Key 不开放',
                $code === 404 => "model={$modelId} 在此服务商不存在，或地址错",
                $code === 429 => '触发限流，可稍后重试',
                $code >= 500 => '上游服务器异常',
                default       => '请求被拒绝',
            };

            return $this->error(
                "深度测试失败：HTTP {$code}，{$hint}{$bodySummary}",
                $code,
                $url
            );
        } catch (ConnectionException $e) {
            return $this->error(
                "深度测试无法连接（model={$modelId}）：" . $this->classifyConnectionError($e->getMessage()),
                null,
                $url
            );
        } catch (Throwable $e) {
            Log::warning("[provider.deep-probe] id={$provider->id} model={$modelId} err=" . $e->getMessage());
            return $this->error('深度测试异常：' . $e->getMessage(), null, $url);
        }
    }

    private function error(string $message, ?int $httpStatus, string $endpoint): array
    {
        return [
            'status'      => 'error',
            'message'     => $message,
            'http_status' => $httpStatus,
            'endpoint'    => $endpoint,
        ];
    }

    /**
     * Guzzle / Symfony 抛 ConnectionException 时 message 包含具体原因关键词，
     * 这里翻译为运维能直接行动的提示。
     */
    private function classifyConnectionError(string $msg): string
    {
        $lower = strtolower($msg);
        if (str_contains($lower, 'timed out') || str_contains($lower, 'timeout')) {
            return "请求超时，建议检查上游网络稳定性或提高超时时间。原始错误：{$msg}";
        }
        if (str_contains($lower, 'could not resolve host') || str_contains($lower, 'getaddrinfo') || str_contains($lower, 'name or service not known')) {
            return "DNS 解析失败，请检查域名拼写。原始错误：{$msg}";
        }
        if (str_contains($lower, 'ssl') || str_contains($lower, 'certificate') || str_contains($lower, 'tls')) {
            return "SSL/TLS 证书校验失败，请检查证书有效期或域名是否匹配。原始错误：{$msg}";
        }
        if (str_contains($lower, 'connection refused')) {
            return "目标主机拒绝连接（端口未开放？）。原始错误：{$msg}";
        }
        return $msg;
    }

    /**
     * 截短上游错误 body 拼到错误信息里。
     *
     * 防御性 redact：上游服务理论上不应回显我们的 Authorization / API Key，
     * 但如果上游错误信息里因 echo / debug 暴露了 token 字符串，这里兜底脱敏，
     * 避免敏感凭证经由「测试失败」消息回流到前端 / 浏览器控制台 / Sentry 等链路。
     */
    private function summarizeErrorBody(string $body): string
    {
        $body = trim($body);
        if ($body === '') return '';
        $body = preg_replace('/Bearer\s+[A-Za-z0-9\-._~+\/]{8,}=*/i', 'Bearer ***', $body) ?? $body;
        $body = preg_replace('/sk-[A-Za-z0-9_\-]{16,}/i', 'sk-***', $body) ?? $body;
        $short = mb_strimwidth($body, 0, 240, '...');
        return "\n上游响应：{$short}";
    }
}
