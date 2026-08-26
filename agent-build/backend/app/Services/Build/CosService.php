<?php

namespace App\Services\Build;

use App\Services\SystemSetting\SettingService;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * 腾讯云 COS V5 客户端（手写签名，不引入 qcloud/cos-sdk-v5 SDK）。
 *
 * 配置来源：system_settings 表 group_key='cos'，由 SystemSettingsController 维护。
 *
 * 提供能力：
 *  - testConnection()       PUT/HEAD/DELETE 一个临时对象，验证账户、桶、权限
 *  - headObject($key)       判断对象是否存在
 *  - deleteObject($key)     删除对象
 *  - getPresignedUrl($key)  生成 GET 预签 URL（默认走自定义域名 cos3.xiaoyinet.cn）
 *
 * 不在这里下载文件 —— 用 302 redirect 让客户端直接连 COS。
 */
class CosService
{
    private SettingService $settings;

    public function __construct(SettingService $settings)
    {
        $this->settings = $settings;
    }

    /**
     * 加载配置。返回 null 表示未配置完整。
     *
     * @return array{
     *   region:string,
     *   bucket:string,
     *   app_id:string,
     *   secret_id:string,
     *   secret_key:string,
     *   custom_domain:string
     * }|null
     */
    public function loadConfig(): ?array
    {
        $g = $this->settings->getGroup('cos');
        $required = ['region', 'bucket', 'secret_id', 'secret_key'];
        foreach ($required as $k) {
            if (empty($g[$k] ?? null)) return null;
        }
        return [
            'region' => trim((string) $g['region']),
            'bucket' => trim((string) $g['bucket']),
            'app_id' => trim((string) ($g['app_id'] ?? '')),
            'secret_id' => trim((string) $g['secret_id']),
            'secret_key' => trim((string) $g['secret_key']),
            'custom_domain' => trim((string) ($g['custom_domain'] ?? '')),
        ];
    }

    public function isConfigured(): bool
    {
        return $this->loadConfig() !== null;
    }

    /**
     * 测试连通性：PUT 一个 1 byte 的对象 → HEAD 验证 → DELETE 清理。
     *
     * @return array{ok:bool, msg:string, endpoint?:string}
     */
    public function testConnection(): array
    {
        $cfg = $this->loadConfig();
        if (!$cfg) {
            return ['ok' => false, 'msg' => 'cos_not_configured'];
        }

        $key = 'connection-test/' . uniqid('test-', true) . '.txt';
        $body = 'agent-build cos test ' . now()->toIso8601String();
        $endpoint = $this->cosEndpoint($cfg);
        $url = $endpoint . '/' . $this->encodeKey($key);

        try {
            // PUT
            $putAuth = $this->signAuth('PUT', '/' . $this->encodeKey($key), $cfg);
            $putResp = Http::timeout(15)
                ->withHeaders(['Authorization' => $putAuth, 'Content-Type' => 'text/plain'])
                ->withBody($body, 'text/plain')
                ->put($url);
            if (!$putResp->successful()) {
                return [
                    'ok' => false,
                    'msg' => 'put_failed: status=' . $putResp->status() . ' body=' . substr($putResp->body(), 0, 300),
                    'endpoint' => $endpoint,
                ];
            }

            // HEAD
            $headAuth = $this->signAuth('HEAD', '/' . $this->encodeKey($key), $cfg);
            $headResp = Http::timeout(10)
                ->withHeaders(['Authorization' => $headAuth])
                ->head($url);
            if (!$headResp->successful()) {
                return [
                    'ok' => false,
                    'msg' => 'head_failed_after_put: status=' . $headResp->status(),
                    'endpoint' => $endpoint,
                ];
            }

            // DELETE (best-effort)
            $delAuth = $this->signAuth('DELETE', '/' . $this->encodeKey($key), $cfg);
            Http::timeout(10)
                ->withHeaders(['Authorization' => $delAuth])
                ->delete($url);

            return [
                'ok' => true,
                'msg' => 'PUT/HEAD/DELETE all ok',
                'endpoint' => $endpoint,
            ];
        } catch (\Throwable $e) {
            return [
                'ok' => false,
                'msg' => 'exception: ' . $e->getMessage(),
                'endpoint' => $endpoint,
            ];
        }
    }

    /**
     * HEAD 对象，判断存在。
     */
    public function headObject(string $objectKey): bool
    {
        $cfg = $this->loadConfig();
        if (!$cfg) return false;
        $endpoint = $this->cosEndpoint($cfg);
        $key = ltrim($objectKey, '/');
        $auth = $this->signAuth('HEAD', '/' . $this->encodeKey($key), $cfg);
        try {
            $resp = Http::timeout(10)
                ->withHeaders(['Authorization' => $auth])
                ->head($endpoint . '/' . $this->encodeKey($key));
            return $resp->successful();
        } catch (\Throwable $e) {
            Log::warning('[CosService] headObject exception', ['key' => $objectKey, 'err' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * 删除对象。
     */
    public function deleteObject(string $objectKey): bool
    {
        $cfg = $this->loadConfig();
        if (!$cfg) return false;
        $endpoint = $this->cosEndpoint($cfg);
        $key = ltrim($objectKey, '/');
        $auth = $this->signAuth('DELETE', '/' . $this->encodeKey($key), $cfg);
        try {
            $resp = Http::timeout(15)
                ->withHeaders(['Authorization' => $auth])
                ->delete($endpoint . '/' . $this->encodeKey($key));
            return $resp->successful() || $resp->status() === 404;
        } catch (\Throwable $e) {
            Log::warning('[CosService] deleteObject exception', ['key' => $objectKey, 'err' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * 生成 GET 预签 URL，默认走自定义域名（如配置）方便 CDN。
     *
     * V5 预签格式：完整 URL?{Authorization-as-query}
     */
    public function getPresignedUrl(string $objectKey, int $expireSeconds = 1800): ?string
    {
        $cfg = $this->loadConfig();
        if (!$cfg) return null;
        $endpoint = $this->presignEndpoint($cfg);
        $key = ltrim($objectKey, '/');
        $auth = $this->signAuth('GET', '/' . $this->encodeKey($key), $cfg, $expireSeconds);
        return $endpoint . '/' . $this->encodeKey($key) . '?' . $auth;
    }

    /**
     * 上传/下载/管理用的官方 COS 域名（永远 https）。
     */
    private function cosEndpoint(array $cfg): string
    {
        return "https://{$cfg['bucket']}.cos.{$cfg['region']}.myqcloud.com";
    }

    /**
     * 预签 URL 用的域名：优先 custom_domain。
     */
    private function presignEndpoint(array $cfg): string
    {
        if (!empty($cfg['custom_domain'])) {
            $d = $cfg['custom_domain'];
            if (!str_starts_with($d, 'http://') && !str_starts_with($d, 'https://')) {
                $d = 'https://' . $d;
            }
            return rtrim($d, '/');
        }
        return $this->cosEndpoint($cfg);
    }

    /**
     * URL 编码对象 key，但保留 `/`（COS 路径分隔符）。
     */
    private function encodeKey(string $key): string
    {
        return implode('/', array_map('rawurlencode', explode('/', $key)));
    }

    /**
     * 生成 V5 签名的 Authorization 字符串。
     *
     * 文档：https://cloud.tencent.com/document/product/436/7778
     */
    private function signAuth(string $method, string $uri, array $cfg, int $expireSeconds = 1800): string
    {
        $startTime = time() - 60; // 容忍 1 分钟时钟漂移
        $endTime = time() + $expireSeconds;
        $signTime = "{$startTime};{$endTime}";

        $signKey = hash_hmac('sha1', $signTime, $cfg['secret_key']);

        $httpMethod = strtolower($method);
        $httpUri = $uri;

        // 此实现不签 query / 自定义 header（仅签 method+uri 已足以满足 GET/PUT/HEAD/DELETE 主对象操作）
        $httpQuery = '';
        $httpHeaders = '';
        $headerList = '';
        $paramList = '';

        $formatString = "{$httpMethod}\n{$httpUri}\n{$httpQuery}\n{$httpHeaders}\n";
        $stringToSign = "sha1\n{$signTime}\n" . sha1($formatString) . "\n";
        $signature = hash_hmac('sha1', $stringToSign, $signKey);

        return 'q-sign-algorithm=sha1'
            . '&q-ak=' . $cfg['secret_id']
            . '&q-sign-time=' . $signTime
            . '&q-key-time=' . $signTime
            . '&q-header-list=' . $headerList
            . '&q-url-param-list=' . $paramList
            . '&q-signature=' . $signature;
    }
}
