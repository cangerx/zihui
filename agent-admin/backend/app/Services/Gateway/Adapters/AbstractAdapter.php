<?php

namespace App\Services\Gateway\Adapters;

use App\Models\CloudProvider;
use App\Support\ApiBase;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;

/**
 * 适配器公共基类。提供所有 OpenAI 系适配器共享的工具：
 *
 *   - 鉴权 header 应用：根据 provider.config.auth_style 切换 Bearer / Azure 风格 api-key /
 *     query string 三种风格
 *   - 自定义 header / query / SSL / proxy 应用：从 provider.config 读取，无值时不动
 *   - URL 拼接：默认走 ApiBase::normalize，子类可重写以适配特殊路径
 *   - 错误体脱敏 + 截短：沿用 ProviderProbe::summarizeErrorBody 的实现
 *   - ConnectionException 分类：沿用 ProviderProbe::classifyConnectionError 的实现
 *   - usage 提取：从 OpenAI 形态响应里提取 prompt/completion/total tokens
 *
 * 子类只需重写真正不同的部分（URL / 鉴权方式 / 请求体），其他保持继承。
 */
abstract class AbstractAdapter implements ProviderAdapter
{
    /**
     * 上游基础地址（不含 endpoint 段），默认走 ApiBase::normalize 自动补 /v1。
     * 子类可重写此方法以构造特殊路径（例如带 deployment / model 名的部署形态）。
     */
    protected function baseUrl(CloudProvider $provider): string
    {
        return ApiBase::normalize($provider->api_base);
    }

    /**
     * 把 endpoint 段拼到 base url 后。子类可重写以应对路径中带 deployment / model 名的特殊情况。
     */
    protected function buildUrl(CloudProvider $provider, string $endpoint): string
    {
        $base = $this->baseUrl($provider);
        if ($base === '') {
            return $endpoint;
        }
        return $base . '/' . ltrim($endpoint, '/');
    }

    /**
     * 构造一个 PendingRequest，应用所有 provider.config 里的通用配置：
     *   - 鉴权方式（auth_style：bearer / azure_api_key / query）
     *   - 自定义 headers / query
     *   - 是否跳过 SSL 校验
     *   - 代理
     *   - 超时
     */
    protected function buildHttp(CloudProvider $provider, string $apiKey, int $timeoutSeconds): PendingRequest
    {
        $config = $this->config($provider);
        $authStyle = $config['auth_style'] ?? 'bearer';

        $http = Http::timeout($timeoutSeconds);

        // 鉴权 header
        if ($authStyle === 'bearer') {
            $http = $http->withToken($apiKey);
        } elseif ($authStyle === 'azure_api_key') {
            // Azure OpenAI：api-key: <key> header（不是 Bearer）
            $http = $http->withHeaders(['api-key' => $apiKey]);
        }
        // query 鉴权由 buildUrl / applyQuery 阶段处理（不在 header 里）

        // 默认浏览器风格 UA + Accept 头：
        // 部分第三方 OpenAI 兼容代理（如 api.772.ee）按 User-Agent 区分真实客户端
        // vs server-to-server 调用，对默认 GuzzleHttp/x.x 的请求做能力降级
        // （实测：gpt-image-2 4K 静默回落 1K）。统一 spoof 浏览器 UA 让上游一视同仁。
        // 用户可通过 provider.config.extra_headers 覆盖（extra_headers 在下方应用）。
        $http = $http->withHeaders([
            'User-Agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept' => '*/*',
            'Accept-Encoding' => 'gzip, deflate, br',
        ]);

        // 自定义 headers（可覆盖上面的默认 UA / Accept / Accept-Encoding）
        $extraHeaders = $config['extra_headers'] ?? [];
        if (is_array($extraHeaders) && !empty($extraHeaders)) {
            $http = $http->withHeaders($extraHeaders);
        }

        // SSL
        if (($config['verify_ssl'] ?? true) === false) {
            $http = $http->withoutVerifying();
        }

        // 代理
        if (!empty($config['proxy'])) {
            $http = $http->withOptions(['proxy' => $config['proxy']]);
        }

        return $http;
    }

    /**
     * 把 provider.config 里的 extra_query 与 auth_style=query 时的 api_key 一起拼到 URL。
     * 不修改原 URL 已有的 query string。
     */
    protected function applyQuery(string $url, CloudProvider $provider, string $apiKey): string
    {
        $config = $this->config($provider);
        $extra = $config['extra_query'] ?? [];

        // auth_style=query 时把 api_key 作为查询参数（默认参数名 api-key，与 Azure 一致；可由 config.query_key_name 覆盖）
        if (($config['auth_style'] ?? 'bearer') === 'query') {
            $keyName = $config['query_key_name'] ?? 'api-key';
            $extra = array_merge([$keyName => $apiKey], is_array($extra) ? $extra : []);
        }

        if (empty($extra) || !is_array($extra)) {
            return $url;
        }

        $sep = str_contains($url, '?') ? '&' : '?';
        return $url . $sep . http_build_query($extra);
    }

    /**
     * 安全读取 provider.config（json 字段），未配置时给空数组。
     */
    protected function config(CloudProvider $provider): array
    {
        $config = $provider->config ?? null;
        if (is_string($config)) {
            $decoded = json_decode($config, true);
            return is_array($decoded) ? $decoded : [];
        }
        return is_array($config) ? $config : [];
    }

    /**
     * 从 OpenAI 形态响应里抽取 usage 三元组。无 usage 字段时返回空数组。
     */
    protected function extractUsage(?array $body): array
    {
        if (!is_array($body) || !isset($body['usage']) || !is_array($body['usage'])) {
            return [];
        }
        $u = $body['usage'];
        $prompt = (int) ($u['prompt_tokens'] ?? 0);
        $completion = (int) ($u['completion_tokens'] ?? 0);
        $total = (int) ($u['total_tokens'] ?? ($prompt + $completion));
        return [
            'prompt_tokens'     => $prompt,
            'completion_tokens' => $completion,
            'total_tokens'      => $total,
        ];
    }

    /**
     * Guzzle / Symfony 抛 ConnectionException 时把原始 message 翻译为运维能行动的提示。
     * 与 ProviderProbe::classifyConnectionError 行为对齐。
     */
    protected function classifyConnectionError(string $msg): string
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
     * 截短上游错误 body 拼到错误信息里，并兜底脱敏 Bearer / sk-xxx 凭证。
     * 与 ProviderProbe::summarizeErrorBody 行为对齐。
     */
    protected function summarizeErrorBody(string $body): string
    {
        $body = trim($body);
        if ($body === '') return '';
        $body = preg_replace('/Bearer\s+[A-Za-z0-9\-._~+\/]{8,}=*/i', 'Bearer ***', $body) ?? $body;
        $body = preg_replace('/sk-[A-Za-z0-9_\-]{16,}/i', 'sk-***', $body) ?? $body;
        $short = mb_strimwidth($body, 0, 240, '...');
        return "\n上游响应：{$short}";
    }
}
