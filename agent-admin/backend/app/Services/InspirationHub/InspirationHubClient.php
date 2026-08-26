<?php

namespace App\Services\InspirationHub;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * 共享灵感库 HTTP 客户端。
 *
 * 封装本云控端 → agent-build hub 的所有调用：
 *  - endpoint 来自 cloudbuild.agent_build.base_url（与云打包共用，无需用户单独配置）
 *  - Origin 头从当前请求的 host 自动推导，agent-build 的 VerifyDomainBinding 中间件按域名鉴权
 *    （inspiration-hub 路由组与 /api/build/* 共用同一中间件）
 *  - 网络层错误统一转抛 RuntimeException('inspiration_hub_unreachable')，由 controller 层捕获
 *
 * 历史：1.x 早期版本曾有独立的 inspiration_hub_enabled / endpoint / origin 三件套
 * SystemSetting 配置，后并入云打包配置以简化运维（一处配，两处用）。
 * 旧 SystemSetting row 不再读写，但保留字段定义避免破坏既有 DB schema。
 *
 * 端点路径前缀：所有 hub 路径都挂在 /api/inspiration-hub 下。
 */
class InspirationHubClient
{
    private const PATH_PREFIX = '/api/inspiration-hub';
    private const CONNECT_TIMEOUT = 5;
    private const TIMEOUT = 15;

    /**
     * hub 服务端点。与云打包共用 cloudbuild.agent_build.base_url，运维配一处即可。
     */
    public function endpoint(): string
    {
        return rtrim((string) config('cloudbuild.agent_build.base_url', ''), '/');
    }

    /**
     * 本云控端在 hub 上的 Origin。
     *
     * 推导逻辑与 AgentBuildClient 保持一致（runtime host > 显式 config > APP_URL，强制 https）。
     * 关键点：Laravel 在反代后默认不信任 X-Forwarded-Proto，request()->isSecure() 会误判 false，
     * getSchemeAndHttpHost() 返回 http:// 导致 VerifyDomainBinding 匹配失败，故出口强制 https。
     */
    public function origin(): string
    {
        // 1.6.3 起优先使用打包平台「验证锁定身份」（auth-check 实际验证过的 origin，
        // 见 BuildIdentityService）；未锁定时回退原有运行时推导链，行为与旧版一致。
        $locked = \App\Services\CloudBuild\BuildIdentityService::lockedOrigin();
        if ($locked !== '') {
            return $locked;
        }
        $req = request();
        $runtimeHost = $req ? rtrim($req->getSchemeAndHttpHost(), '/') : '';
        $configured = rtrim((string) config('cloudbuild.agent_build.origin', ''), '/');
        $appUrl = rtrim((string) config('app.url', ''), '/');
        $origin = $runtimeHost ?: ($configured ?: $appUrl);
        return preg_replace('#^http://#i', 'https://', $origin);
    }

    /**
     * 是否已就绪。共享库默认始终启用，只要云打包 base_url 有配（默认就有官方地址）就视为就绪。
     */
    public function isReady(): bool
    {
        return $this->endpoint() !== '' && $this->origin() !== '';
    }

    public function get(string $path, array $query = []): Response
    {
        return $this->request('GET', $path, ['query' => $query]);
    }

    public function post(string $path, array $body = []): Response
    {
        return $this->request('POST', $path, ['json' => $body]);
    }

    public function put(string $path, array $body = []): Response
    {
        return $this->request('PUT', $path, ['json' => $body]);
    }

    public function delete(string $path): Response
    {
        return $this->request('DELETE', $path);
    }

    /**
     * 健康检查：调 /me 看 endpoint + origin 是否被 hub 接受。
     * - 200 → ok
     * - 401/403 → origin_unauthorized（域名未在 hub 上授权）
     * - 网络层错 → unreachable
     */
    public function healthCheck(): array
    {
        if ($this->endpoint() === '') {
            return ['ok' => false, 'reason' => 'endpoint_empty'];
        }
        if ($this->origin() === '') {
            return ['ok' => false, 'reason' => 'origin_empty'];
        }

        try {
            $resp = $this->get('/me');
        } catch (RuntimeException $e) {
            return ['ok' => false, 'reason' => $e->getMessage()];
        }

        $status = $resp->status();
        if ($resp->successful()) {
            return [
                'ok' => true,
                'status' => $status,
                'me' => $resp->json(),
            ];
        }
        if ($status === 401 || $status === 403) {
            return ['ok' => false, 'reason' => 'origin_unauthorized', 'status' => $status, 'body' => $resp->json()];
        }
        return ['ok' => false, 'reason' => 'http_error', 'status' => $status, 'body' => $resp->json()];
    }

    private function client(): PendingRequest
    {
        if (!$this->isReady()) {
            throw new RuntimeException('inspiration_hub_not_configured');
        }

        return Http::withHeaders([
            'Origin'           => $this->origin(),
            'Accept'           => 'application/json',
            'X-Requested-With' => 'XMLHttpRequest',
        ])
            ->timeout(self::TIMEOUT)
            ->connectTimeout(self::CONNECT_TIMEOUT)
            ->acceptJson();
    }

    private function request(string $method, string $path, array $options = []): Response
    {
        $url = $this->endpoint() . self::PATH_PREFIX . $path;
        $client = $this->client();

        try {
            switch (strtoupper($method)) {
                case 'GET':
                    return $client->get($url, $options['query'] ?? []);
                case 'POST':
                    return $client->post($url, $options['json'] ?? []);
                case 'PUT':
                    return $client->put($url, $options['json'] ?? []);
                case 'DELETE':
                    return $client->delete($url);
                default:
                    throw new RuntimeException("unsupported_method:{$method}");
            }
        } catch (\Illuminate\Http\Client\ConnectionException $e) {
            Log::warning('[InspirationHubClient] connection failed', [
                'method' => $method,
                'url'    => $url,
                'msg'    => $e->getMessage(),
            ]);
            throw new RuntimeException('inspiration_hub_unreachable');
        }
    }
}
