<?php

namespace App\Services\CloudBuild;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Agent-Build SDK (Domain-only auth, agent-build 0.2.0+).
 *
 * 入站请求只携带 Origin 头（即本站身份域名），由 agent-build 的 VerifyDomainBinding
 * 中间件按 Origin 对应 host 是否在 authorized_clients 白名单决定放行。
 *
 * Origin 来源（1.6.3 起改为「验证锁定身份」机制，见 BuildIdentityService）：
 *   已验证锁定身份 > 当前请求 host > 旧版显式配置 > APP_URL
 * 锁定身份由 auth-check 实际验证产生并落库，页面 / cron / 队列统一复用；
 * 调用被拒 domain_not_authorized 时自动重新解析候选并重试（10 分钟冷却），
 * 平台端换绑域名 / 推导环境变化均可自愈，全程无需用户配置。
 */
class AgentBuildClient
{
    private string $baseUrl;
    private string $origin;
    private int $timeoutSeconds;
    private bool $verifySsl;
    /** 正在执行身份探测：探测期间的请求不再触发自愈，防递归 */
    private bool $probing = false;

    public function __construct()
    {
        $this->baseUrl = rtrim((string) config('cloudbuild.agent_build.base_url'), '/');
        $this->timeoutSeconds = (int) config('cloudbuild.agent_build.timeout_seconds', 15);
        $this->verifySsl = (bool) config('cloudbuild.agent_build.verify_ssl', false);

        // 静默记录候选身份（仅 HTTP 上下文；值未变化零写入）
        BuildIdentityService::recordCandidateFromRequest();

        $this->origin = $this->resolvePreferredOrigin();
    }

    /**
     * 已验证锁定身份优先；未锁定时回退运行时推导链（与旧版行为一致，保证升级平滑）。
     */
    private function resolvePreferredOrigin(): string
    {
        $locked = BuildIdentityService::lockedOrigin();
        if ($locked !== '') {
            return $locked;
        }

        $req = app()->runningInConsole() ? null : request();
        $runtimeHost = $req ? BuildIdentityService::normalizeOrigin(rtrim($req->getSchemeAndHttpHost(), '/')) : '';
        if ($runtimeHost !== '' && BuildIdentityService::isUsableOrigin($runtimeHost)) {
            return $runtimeHost;
        }

        $configured = BuildIdentityService::normalizeOrigin((string) config('cloudbuild.agent_build.origin', ''));
        if ($configured !== '') {
            return $configured;
        }
        return BuildIdentityService::normalizeOrigin((string) config('app.url', ''));
    }

    public function isConfigured(): bool
    {
        return $this->baseUrl !== '';
    }

    /** 当前对外声明的站点身份（日志 / 诊断用） */
    public function currentOrigin(): string
    {
        return $this->origin;
    }

    /**
     * 依次用候选身份探测 auth-check，命中即锁定落库并切换当前身份。
     * 返回锁定的 origin；全部失败返回空串（保持原身份不变）。
     */
    public function resolveIdentityByProbe(): string
    {
        if (!$this->isConfigured() || $this->probing) {
            return '';
        }
        $this->probing = true;
        try {
            foreach (BuildIdentityService::candidateOrigins() as $candidate) {
                $resp = $this->rawRequest('GET', '/api/build/auth-check', null, 10, $candidate);
                if (($resp['_status'] ?? 0) === 200 && ($resp['authorized'] ?? false) === true) {
                    BuildIdentityService::lock($candidate);
                    $this->origin = $candidate;
                    return $candidate;
                }
            }
            Log::warning('[AgentBuildClient] identity probe exhausted, no candidate authorized', [
                'candidates' => BuildIdentityService::candidateOrigins(),
            ]);
            return '';
        } finally {
            $this->probing = false;
        }
    }

    /** GET /api/build/auth-check —— 预检：仅返回 {authorized: bool, ...}，不暴露其它授权站点 */
    public function checkAuth(): array
    {
        return $this->call('GET', '/api/build/auth-check');
    }

    /** GET /api/license/site —— 打包许可两档，不受 BUILD_PACKAGING_RETIRED 影响 */
    public function siteLicense(): array
    {
        return $this->call('GET', '/api/license/site');
    }

    /**
     * POST /api/build/request
     * 1.2.5：用 60s timeout 覆盖默认 15s。原因：agent-build 0.3.2 及以下
     * 该端点是同步调用 GitHub Actions workflow_dispatch（最多 15s timeout），
     * 跨区慢网下整端点常耗时 5-15+s，agent-admin 默认 15s 容易在 GitHub 已成功
     * dispatch 但 agent-admin 这边超时 → 远端 build_request 已建 + GitHub Actions
     * 已启动，但本端 cloud_builds 没插行 → 任务在云控端「消失」。
     *
     * agent-build 0.3.3 起 dispatch 改为异步，此 timeout 可恢复 15s。
     */
    public function requestBuild(string $appName, string $platform, ?string $iconUrl = null): array
    {
        $body = ['app_name' => $appName, 'platform' => $platform];
        if ($iconUrl) {
            $body['icon_url'] = $iconUrl;
        }
        return $this->call('POST', '/api/build/request', $body, 60);
    }

    public function requestOemBuild(
        string $appName,
        string $platform,
        string $iconUrl,
        string $projectKey,
        string $appId,
        string $updatePath,
        ?string $appVersion = null,
        array $buildOptions = []
    ): array {
        $body = [
            'app_name' => $appName,
            'platform' => $platform,
            'icon_url' => $iconUrl,
            'build_mode' => 'oem',
            'oem_project_key' => $projectKey,
            'app_id' => $appId,
            'update_path' => $updatePath,
        ];
        if ($appVersion !== null && $appVersion !== '') {
            $body['app_version'] = $appVersion;
        }
        if (!empty($buildOptions)) {
            $body['build_options'] = $buildOptions;
        }
        return $this->call('POST', '/api/build/request', $body, 60);
    }

    /** GET /api/build/status/{buildId} */
    public function getStatus(string $buildId): array
    {
        return $this->call('GET', '/api/build/status/' . $buildId);
    }

    /** POST /api/build/cancel/{buildId} */
    public function cancel(string $buildId): array
    {
        return $this->call('POST', '/api/build/cancel/' . $buildId, []);
    }

    /** GET /api/build/download/{buildId} */
    public function getDownload(string $buildId): array
    {
        return $this->call('GET', '/api/build/download/' . $buildId);
    }

    /** POST /api/build/ack/{buildId} */
    public function ack(string $buildId, string $storedPath, bool $sha256Verified): array
    {
        return $this->call('POST', '/api/build/ack/' . $buildId, [
            'stored_path' => $storedPath,
            'sha256_verified' => $sha256Verified,
        ]);
    }

    /** GET /api/build/list */
    public function listBuilds(int $page = 1, int $pageSize = 20, ?string $status = null, ?string $platform = null): array
    {
        $query = ['page' => $page, 'page_size' => $pageSize];
        if ($status) $query['status'] = $status;
        if ($platform) $query['platform'] = $platform;
        return $this->call('GET', '/api/build/list?' . http_build_query($query));
    }

    /** GET /api/license/desktop-template */
    public function templateInfo(): array
    {
        return $this->call('GET', '/api/license/desktop-template');
    }

    /**
     * GET /api/build/my-info
     * 查当前 Origin 对应授权行的 {domain, owner_name, owner_phone, needs_completion}
     */
    public function getMyInfo(): array
    {
        return $this->call('GET', '/api/build/my-info');
    }

    /**
     * PUT /api/build/my-info
     * 更新姓名 / 电话。body 只带 owner_name + owner_phone；domain 由远端按 Origin 决定，
     * 本方法不接受 domain 参数，调用方也无法伪造。
     */
    public function updateMyInfo(string $ownerName, ?string $ownerPhone): array
    {
        return $this->call('PUT', '/api/build/my-info', [
            'owner_name' => $ownerName,
            'owner_phone' => $ownerPhone,
        ]);
    }

    private function call(string $method, string $path, ?array $body = null, ?int $timeoutOverride = null, bool $retried = false): array
    {
        if (!$this->isConfigured()) {
            return ['_error' => 'agent_build_not_configured', '_status' => 0];
        }

        $payload = $this->rawRequest($method, $path, $body, $timeoutOverride, $this->origin);

        // 身份自愈：当前身份被 agent-build 判为未授权时，重新解析候选并锁定，成功则原请求重试一次。
        // 冷却 10 分钟 + 单次重试 + 探测期间不重入，三重防护避免被拒响应触发探测风暴。
        if (
            !$retried &&
            !$this->probing &&
            ($payload['error'] ?? '') === 'domain_not_authorized' &&
            BuildIdentityService::shouldRecheck()
        ) {
            BuildIdentityService::markRecheckNow();
            $previousOrigin = $this->origin;
            $resolved = $this->resolveIdentityByProbe();
            if ($resolved !== '' && $resolved !== $previousOrigin) {
                Log::info('[AgentBuildClient] identity re-resolved after rejection, retrying', [
                    'from' => $previousOrigin,
                    'to' => $resolved,
                    'path' => $path,
                ]);
                return $this->call($method, $path, $body, $timeoutOverride, true);
            }
        }

        return $payload;
    }

    /**
     * 发送一次原始请求（不含自愈逻辑）。
     * 非 2xx 且响应 JSON 无 error 字段时合成 `_error = http_{status}`，
     * 让上层 messageMap 永远能翻译出具体原因（消灭 "agent-build 拒绝：unknown"）——
     * 典型场景：Laravel 限流 429 的 {message: "Too Many Attempts."}、网关层 JSON 拦截页。
     */
    private function rawRequest(string $method, string $path, ?array $body, ?int $timeoutOverride, string $origin): array
    {
        $rawBody = $body !== null ? json_encode($body, JSON_UNESCAPED_SLASHES) : '';
        $url = $this->baseUrl . $path;

        // 1.3.4 起：把云控端自身版本号写到 X-Admin-Version 头。
        // agent-build 0.6.0+ 用此头做「最低版本闸门」校验：低于配置的 min_admin_version 时
        // 直接 426 拒绝 + 中文升级提示。同时 auth-check 也用此头派生 admin_version_too_low
        // 让前端横幅提前展示，无需等用户点提交才被拒绝。
        $adminVersion = (string) config('version.version', '');
        $headers = [
            'Accept' => 'application/json',
            'Origin' => $origin,
            'User-Agent' => 'agent-admin/' . ($adminVersion !== '' ? $adminVersion : '1.0'),
        ];
        if ($adminVersion !== '') {
            $headers['X-Admin-Version'] = $adminVersion;
        }

        try {
            $timeout = $timeoutOverride !== null && $timeoutOverride > 0 ? $timeoutOverride : $this->timeoutSeconds;
            $http = Http::withHeaders($headers)->timeout($timeout);
            if (!$this->verifySsl) {
                $http = $http->withoutVerifying();
            }

            if ($method === 'GET') {
                $response = $http->get($url);
            } else {
                $request = $http->withHeaders(['Content-Type' => 'application/json'])
                    ->withBody($rawBody, 'application/json');
                $response = match ($method) {
                    'POST' => $request->post($url),
                    'PUT' => $request->put($url),
                    'PATCH' => $request->patch($url),
                    'DELETE' => $request->delete($url),
                    default => throw new \InvalidArgumentException("unsupported method: $method"),
                };
            }

            $payload = $response->json();
            if ($payload === null) {
                $bodyText = substr((string) $response->body(), 0, 300);
                return [
                    '_error' => 'non_json_response',
                    '_status' => $response->status(),
                    '_msg' => "agent-build 返回非 JSON 响应 (HTTP {$response->status()}): {$bodyText}",
                ];
            }
            $payload['_status'] = $response->status();

            $status = $response->status();
            if (($status < 200 || $status >= 300) && !isset($payload['error']) && !isset($payload['_error'])) {
                $payload['_error'] = 'http_' . $status;
                if (isset($payload['message']) && is_string($payload['message'])) {
                    $payload['_msg'] = $payload['message'];
                }
            }
            return $payload;
        } catch (\Throwable $e) {
            Log::error('[AgentBuildClient] transport error', [
                'method' => $method,
                'path' => $path,
                'error' => $e->getMessage(),
            ]);
            return ['_error' => 'transport_error', '_status' => 0, '_msg' => $e->getMessage()];
        }
    }
}
