<?php

namespace App\Services\CloudBuild;

use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * 凭据只从 config/cloudbuild.php（env）读取，禁止写入仓库或票据。
 */
class CloudBuildGitHubDispatchService implements CloudBuildGitHubGateway
{
    public const ERR_WORKFLOW_NOT_FOUND = 'github_workflow_not_found';
    public const ERR_FORBIDDEN = 'github_dispatch_forbidden';
    public const ERR_FAILED = 'github_dispatch_failed';

    private ?string $lastDispatchError = null;

    /** @param array<string, mixed>|null $settings */
    public function __construct(
        private ?HttpFactory $http = null,
        private ?array $settings = null,
    ) {
    }

    public function isConfigured(): bool
    {
        $cfg = $this->github();
        return $cfg['token'] !== '' && $cfg['repo'] !== '';
    }

    public function lastDispatchError(): ?string
    {
        return $this->lastDispatchError;
    }

    public function dispatch(string $platform, array $inputs): bool
    {
        $this->lastDispatchError = null;
        if (!$this->isConfigured()) {
            $this->log('warning', '[CloudBuildGitHub] dispatch skipped: not configured');
            $this->lastDispatchError = self::ERR_FAILED;
            return false;
        }

        $cfg = $this->github();
        $workflow = $platform === 'mac' ? $cfg['workflow_mac'] : $cfg['workflow_win'];
        $url = "https://api.github.com/repos/{$cfg['repo']}/actions/workflows/{$workflow}/dispatches";

        try {
            $response = $this->http()->withHeaders($this->headers())
                ->withOptions(['verify' => $cfg['verify_ssl']])
                ->timeout($cfg['api_timeout'])
                ->post($url, [
                    'ref' => $cfg['ref'],
                    'inputs' => $inputs,
                ]);
        } catch (\Throwable $e) {
            $this->lastDispatchError = self::ERR_FAILED;
            $this->log('error', '[CloudBuildGitHub] dispatch transport error', [
                'error' => $e->getMessage(),
                'url' => $url,
            ]);
            return false;
        }

        if ($response->successful()) {
            return true;
        }

        $status = $response->status();
        $this->lastDispatchError = match ($status) {
            404 => self::ERR_WORKFLOW_NOT_FOUND,
            401, 403 => self::ERR_FORBIDDEN,
            default => self::ERR_FAILED,
        };
        $githubMessage = '';
        try {
            $githubMessage = (string) ($response->json('message') ?? '');
        } catch (\Throwable $e) {
            $githubMessage = '';
        }
        $this->log('error', '[CloudBuildGitHub] dispatch failed', [
            'status' => $status,
            'url' => $url,
            'github_message' => mb_substr($githubMessage, 0, 180),
        ]);
        return false;
    }

    public function cancelRun(int $runId): bool
    {
        if (!$this->isConfigured() || $runId <= 0) {
            return false;
        }

        $cfg = $this->github();
        $url = "https://api.github.com/repos/{$cfg['repo']}/actions/runs/{$runId}/cancel";

        try {
            $response = $this->http()->withHeaders($this->headers())
                ->withOptions(['verify' => $cfg['verify_ssl']])
                ->timeout(15)
                ->post($url);
        } catch (\Throwable $e) {
            $this->log('warning', '[CloudBuildGitHub] cancelRun transport error', [
                'run_id' => $runId,
                'error' => $e->getMessage(),
            ]);
            return false;
        }

        return $response->successful();
    }

    public function getWorkflowRun(int $runId): ?array
    {
        if (!$this->isConfigured() || $runId <= 0) {
            return null;
        }

        $cfg = $this->github();
        $url = "https://api.github.com/repos/{$cfg['repo']}/actions/runs/{$runId}";

        try {
            $response = $this->http()->withHeaders($this->headers())
                ->withOptions(['verify' => $cfg['verify_ssl']])
                ->timeout((int) ($cfg['api_timeout'] ?? 30))
                ->get($url);
        } catch (\Throwable $e) {
            $this->log('warning', '[CloudBuildGitHub] getWorkflowRun transport error', [
                'run_id' => $runId,
                'error' => $e->getMessage(),
            ]);
            return null;
        }

        if (!$response->successful()) {
            return null;
        }

        return $this->normalizeRun((array) $response->json());
    }

    public function findRecentWorkflowRun(string $platform, string $createdAfterIso, array $excludeRunIds = []): ?array
    {
        if (!$this->isConfigured()) {
            return null;
        }

        $cfg = $this->github();
        $workflow = $platform === 'mac' ? $cfg['workflow_mac'] : $cfg['workflow_win'];
        $url = "https://api.github.com/repos/{$cfg['repo']}/actions/workflows/{$workflow}/runs?event=workflow_dispatch&per_page=20";

        try {
            $response = $this->http()->withHeaders($this->headers())
                ->withOptions(['verify' => $cfg['verify_ssl']])
                ->timeout((int) ($cfg['api_timeout'] ?? 30))
                ->get($url);
        } catch (\Throwable $e) {
            $this->log('warning', '[CloudBuildGitHub] findRecentWorkflowRun transport error', [
                'error' => $e->getMessage(),
            ]);
            return null;
        }

        if (!$response->successful()) {
            return null;
        }

        $exclude = [];
        foreach ($excludeRunIds as $id) {
            $exclude[(int) $id] = true;
        }
        $after = strtotime($createdAfterIso) ?: 0;
        $best = null;
        $bestCreated = 0;
        foreach ((array) ($response->json('workflow_runs') ?? []) as $run) {
            if (!is_array($run)) {
                continue;
            }
            $normalized = $this->normalizeRun($run);
            if ($normalized === null || isset($exclude[$normalized['id']])) {
                continue;
            }
            $created = strtotime((string) ($run['created_at'] ?? '')) ?: 0;
            if ($after > 0 && $created + 15 < $after) {
                continue;
            }
            if ($best === null || $created > $bestCreated) {
                $best = $normalized;
                $bestCreated = $created;
            }
        }

        return $best;
    }

    /**
     * @param array<string, mixed> $run
     * @return array{id:int,status:string,conclusion:?string,html_url:string}|null
     */
    private function normalizeRun(array $run): ?array
    {
        $id = (int) ($run['id'] ?? 0);
        if ($id <= 0) {
            return null;
        }
        $conclusion = $run['conclusion'] ?? null;
        return [
            'id' => $id,
            'status' => (string) ($run['status'] ?? ''),
            'conclusion' => is_string($conclusion) && $conclusion !== '' ? $conclusion : null,
            'html_url' => (string) ($run['html_url'] ?? ''),
        ];
    }

    public function downloadTo(string $url, string $sinkPath, int $resumeFrom = 0): array
    {
        if (!$this->isConfigured() || $url === '') {
            return ['ok' => false, 'bytes' => 0, 'error' => 'not_configured'];
        }

        $dir = dirname($sinkPath);
        if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
            return ['ok' => false, 'bytes' => 0, 'error' => 'mkdir_failed'];
        }

        $mode = $resumeFrom > 0 ? 'ab' : 'wb';
        $fp = fopen($sinkPath, $mode);
        if ($fp === false) {
            return ['ok' => false, 'bytes' => 0, 'error' => 'open_failed'];
        }

        $cfg = $this->github();
        $bytes = 0;
        $ch = curl_init($url);
        $headers = $this->downloadRequestHeaders();
        if ($resumeFrom > 0) {
            $headers[] = 'Range: bytes=' . $resumeFrom . '-';
        }
        curl_setopt_array($ch, [
            CURLOPT_FILE => $fp,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 5,
            CURLOPT_TIMEOUT => (int) ($cfg['download_timeout'] ?? 1800),
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_SSL_VERIFYPEER => (bool) $cfg['verify_ssl'],
            CURLOPT_SSL_VERIFYHOST => $cfg['verify_ssl'] ? 2 : 0,
        ]);
        $ok = curl_exec($ch);
        $http = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        fclose($fp);

        $size = is_file($sinkPath) ? (int) filesize($sinkPath) : 0;
        $bytes = max(0, $size - $resumeFrom);
        $success = $ok && ($http === 200 || $http === 206);
        if (!$success) {
            return ['ok' => false, 'bytes' => $bytes, 'error' => 'http_' . $http . ($err ? ':' . $err : '')];
        }
        return ['ok' => true, 'bytes' => $bytes, 'error' => null];
    }

    private function http(): HttpFactory
    {
        if ($this->http instanceof HttpFactory) {
            return $this->http;
        }
        if (function_exists('app')) {
            try {
                $bound = app()->bound('http') ? app('http') : Http::getFacadeRoot();
                if ($bound instanceof HttpFactory) {
                    return $bound;
                }
            } catch (\Throwable $e) {
                // PHPUnit 无 Laravel 容器时走新建 Factory
            }
        }
        return new HttpFactory();
    }

    /**
     * 设置页非空优先，否则 env。
     *
     * @param array<string, mixed> $env
     * @param array{repo?:string,token?:string} $stored
     * @return array<string, mixed>
     */
    public static function mergeGithubConfig(array $env, array $stored): array
    {
        $repo = trim((string) ($stored['repo'] ?? ''));
        $token = trim((string) ($stored['token'] ?? ''));
        if ($repo !== '') {
            $env['repo'] = $repo;
        }
        if ($token !== '') {
            $env['token'] = $token;
        }
        return $env;
    }

    /** @return array<string, mixed> */
    private function github(): array
    {
        if (is_array($this->settings)) {
            return $this->settings;
        }

        $env = [
            'token' => (string) (config('cloudbuild.github.token') ?: ''),
            'repo' => (string) (config('cloudbuild.github.repo') ?: ''),
            'ref' => (string) (config('cloudbuild.github.ref') ?: 'main'),
            'workflow_win' => (string) (config('cloudbuild.github.workflow_win') ?: 'build-win.yml'),
            'workflow_mac' => (string) (config('cloudbuild.github.workflow_mac') ?: 'build-mac.yml'),
            'verify_ssl' => (bool) config('cloudbuild.github.verify_ssl', true),
            'api_timeout' => (int) (config('cloudbuild.github.api_timeout') ?: 30),
            'download_timeout' => (int) (config('cloudbuild.github.download_timeout') ?: 1800),
        ];

        try {
            $stored = [
                'repo' => (string) \App\Models\SystemSetting::getValue('github_build_repo', ''),
                'token' => (string) \App\Models\SystemSetting::getValue('github_build_token', ''),
            ];
            return PackagingLicense::mergeGithubConfig($env, $stored);
        } catch (\Throwable $e) {
            return $env;
        }
    }

    /**
     * 资产下载不能复用 API 的 Accept: application/vnd.github+json，
     * 否则 GitHub 返回 JSON 元数据，sha256 永远对不上安装包。
     *
     * @return list<string>
     */
    public function downloadRequestHeaders(): array
    {
        $token = (string) ($this->github()['token'] ?? '');
        return [
            'Accept: application/octet-stream',
            'Authorization: Bearer ' . $token,
            'X-GitHub-Api-Version: 2022-11-28',
            'User-Agent: agent-admin-cloud-build/1.0',
        ];
    }

    /** @return array<string, string> */
    private function headers(): array
    {
        $token = $this->github()['token'];
        return [
            'Accept' => 'application/vnd.github+json',
            'Authorization' => "Bearer {$token}",
            'X-GitHub-Api-Version' => '2022-11-28',
            'User-Agent' => 'agent-admin-cloud-build/1.0',
        ];
    }

    /**
     * @param array<string, mixed> $ctx
     */
    private function log(string $level, string $message, array $ctx = []): void
    {
        try {
            if ($level === 'error') {
                Log::error($message, $ctx);
                return;
            }
            Log::warning($message, $ctx);
        } catch (\Throwable $e) {
            // 单测 harness 没有 log 容器
        }
    }
}
