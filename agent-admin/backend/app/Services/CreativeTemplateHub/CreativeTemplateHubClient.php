<?php

namespace App\Services\CreativeTemplateHub;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

class CreativeTemplateHubClient
{
    private const PATH_PREFIX = '/api/creative-template-hub';
    private const CONNECT_TIMEOUT = 5;
    private const TIMEOUT = 15;

    public function endpoint(): string
    {
        return rtrim((string) config('cloudbuild.agent_build.base_url', ''), '/');
    }

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
            return ['ok' => true, 'status' => $status, 'me' => $resp->json()];
        }
        if ($status === 401 || $status === 403) {
            return ['ok' => false, 'reason' => 'origin_unauthorized', 'status' => $status, 'body' => $resp->json()];
        }
        return ['ok' => false, 'reason' => 'http_error', 'status' => $status, 'body' => $resp->json()];
    }

    private function client(): PendingRequest
    {
        if (!$this->isReady()) {
            throw new RuntimeException('creative_template_hub_not_configured');
        }

        return Http::withHeaders([
            'Origin' => $this->origin(),
            'Accept' => 'application/json',
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
            Log::warning('[CreativeTemplateHubClient] connection failed', [
                'method' => $method,
                'url' => $url,
                'msg' => $e->getMessage(),
            ]);
            throw new RuntimeException('creative_template_hub_unreachable');
        }
    }
}
