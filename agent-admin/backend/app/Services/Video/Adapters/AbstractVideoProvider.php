<?php

namespace App\Services\Video\Adapters;

use App\Models\VideoProviderAccount;
use App\Services\StorageService;
use Illuminate\Support\Facades\Log;

/**
 * 通用视频 Provider 基类：统一 HTTP 调用、鉴权风格（auth_style）与连接配置（config）。
 *
 * config 支持：
 *   - verify_ssl   bool   关闭 SSL 校验（默认 true）
 *   - proxy        string 代理地址
 *   - extra_headers object 额外请求头
 *
 * auth_style 支持：
 *   - bearer                   Authorization: Bearer {key}（OpenAI 风格，默认）
 *   - raw_authorization_header Authorization: {key}（多米风格）
 */
abstract class AbstractVideoProvider
{
    /**
     * 交上游的参考素材预签名 URL 有效期（秒）。需覆盖「提交 → 上游排队 → 上游回拉参考图」窗口；
     * 取 6h：远大于自身轮询超时（≤4h），又远小于素材对象 24h 清理窗口。
     */
    protected const UPSTREAM_FETCH_TTL = 21600;

    protected function url(VideoProviderAccount $account, string $path): string
    {
        return rtrim((string) $account->base_url, '/') . '/' . ltrim($path, '/');
    }

    /**
     * 交上游前把 input_assets 里的参考素材 URL 换成「上游可直接 HTTP 拉取」的 URL。
     *
     * 背景：视频链路无 materialize（不像生图把 URL 读回 base64 再转发），storage_url 原样交上游
     * 由上游主动回拉。若对象存储桶为私有读，未签名直链会被上游 GET 到 403 → 参考图静默失效。
     * 这里对本站 cos/oss 对象统一换成预签名 GET URL（私有桶也能拉），消除对「桶必须公共读」的
     * 隐式部署依赖；local 绝对 URL、外链、自定义 CDN 域名一律原样保留。
     *
     * 覆盖 input_assets 的全部 URL 形态：assets[].url 与 images/videos/audios 字符串数组，
     * 故 seedance content / veo 首尾帧 / grok / openai media_urls 各分支均自动生效。
     */
    protected function materializeAssetUrls(array $assets): array
    {
        if (is_array($assets['assets'] ?? null)) {
            foreach ($assets['assets'] as &$asset) {
                if (is_array($asset) && isset($asset['url']) && is_string($asset['url'])) {
                    $asset['url'] = $this->toUpstreamUrl($asset['url']);
                }
            }
            unset($asset);
        }
        foreach (['images', 'videos', 'audios'] as $key) {
            if (is_array($assets[$key] ?? null)) {
                $assets[$key] = array_map(
                    fn ($u) => is_string($u) ? $this->toUpstreamUrl($u) : $u,
                    $assets[$key]
                );
            }
        }
        return $assets;
    }

    /**
     * 单个参考素材 URL → 上游可达 URL（本站 cos/oss 私有对象预签名兜底）。
     * 具体规则见 StorageService::upstreamFetchableUrl（视频 / 视觉转发共用同一逻辑）。
     */
    protected function toUpstreamUrl(string $url): string
    {
        return StorageService::upstreamFetchableUrl($url, self::UPSTREAM_FETCH_TTL);
    }

    /**
     * @return array{code:int, data:array, raw:string, err:string}
     */
    protected function request(string $method, string $url, VideoProviderAccount $account, array $payload = [], int $timeout = 60): array
    {
        $method = strtoupper($method);
        $config = is_array($account->config) ? $account->config : [];
        $headers = $this->buildHeaders($account);

        $ch = curl_init();
        $options = [
            CURLOPT_URL => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_ENCODING => '',
            CURLOPT_MAXREDIRS => 10,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
        ];

        if ($method !== 'GET' && $payload !== []) {
            $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if ($body === false) {
                return ['code' => 0, 'data' => [], 'raw' => '', 'err' => '请求 JSON 编码失败'];
            }
            $options[CURLOPT_POSTFIELDS] = $body;
            $options[CURLOPT_HTTPHEADER] = array_merge($headers, ['Content-Type: application/json']);
        }

        if (($config['verify_ssl'] ?? true) === false) {
            $options[CURLOPT_SSL_VERIFYPEER] = false;
            $options[CURLOPT_SSL_VERIFYHOST] = 0;
        }
        if (!empty($config['proxy'])) {
            $options[CURLOPT_PROXY] = (string) $config['proxy'];
        }

        curl_setopt_array($ch, $options);
        $raw = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = $raw === false ? curl_error($ch) : '';
        curl_close($ch);

        $rawText = is_string($raw) ? $raw : '';
        $data = json_decode($rawText, true);
        if (!is_array($data)) {
            $data = [];
        }

        if ($err !== '') {
            Log::warning('[' . class_basename(static::class) . '] request failed', ['url' => $url, 'err' => $err]);
        }

        return ['code' => $code, 'data' => $data, 'raw' => $rawText, 'err' => $err];
    }

    protected function buildHeaders(VideoProviderAccount $account): array
    {
        $headers = ['Accept: application/json'];
        $apiKey = (string) $account->api_key;
        $authStyle = (string) ($account->auth_style ?: 'bearer');

        if ($apiKey !== '') {
            $headers[] = $authStyle === 'raw_authorization_header'
                ? 'Authorization: ' . $apiKey
                : 'Authorization: Bearer ' . $apiKey;
        }

        $config = is_array($account->config) ? $account->config : [];
        $extra = $config['extra_headers'] ?? [];
        if (is_array($extra)) {
            foreach ($extra as $key => $value) {
                if (is_string($key) && $key !== '' && (is_string($value) || is_numeric($value))) {
                    $headers[] = $key . ': ' . $value;
                }
            }
        }

        return $headers;
    }

    /**
     * 判定 HTTP 2xx 响应体是否其实是业务层错误。
     * 部分中转上游（如多米）即使失败也返回 200，把错误码 / 错误信息塞在 body 里，
     * 若不识别会被误报成「缺少任务 ID」，掩盖真实原因（余额不足 / 无权限等）。
     */
    protected function isBusinessError(array $data): bool
    {
        if (array_key_exists('success', $data) && $data['success'] === false) {
            return true;
        }
        foreach (['code', 'status_code', 'errcode', 'ret'] as $key) {
            if (isset($data[$key]) && is_numeric($data[$key])) {
                $c = (int) $data[$key];
                if ($c !== 0 && ($c < 200 || $c >= 300)) {
                    return true;
                }
            }
        }
        return !empty($data['error']);
    }
}
