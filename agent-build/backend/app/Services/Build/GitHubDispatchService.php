<?php

namespace App\Services\Build;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class GitHubDispatchService
{
    private string $token;
    private string $repo;
    private string $ref;

    public function __construct()
    {
        $this->token = (string) config('build.github.token', '');
        $this->repo = (string) config('build.github.repo');
        $this->ref = (string) config('build.github.ref', 'main');
    }

    public function isConfigured(): bool
    {
        return $this->token !== '' && $this->repo !== '';
    }

    private function headers(): array
    {
        return [
            'Accept' => 'application/vnd.github+json',
            'Authorization' => "Bearer {$this->token}",
            'X-GitHub-Api-Version' => '2022-11-28',
            'User-Agent' => 'agent-build/1.0',
        ];
    }

    private function workflowFilename(string $platform): string
    {
        return $platform === 'mac'
            ? (string) config('build.github.workflow_mac', 'build-mac.yml')
            : (string) config('build.github.workflow_win', 'build-win.yml');
    }

    /**
     * 触发 workflow_dispatch。
     * GitHub 不立即返回 run_id，需后续 polling。
     */
    public function dispatch(string $platform, array $inputs): bool
    {
        if (!$this->isConfigured()) {
            Log::warning('[GitHubDispatch] not configured (token missing), skip');
            return false;
        }

        $workflow = $this->workflowFilename($platform);
        $url = "https://api.github.com/repos/{$this->repo}/actions/workflows/{$workflow}/dispatches";

        try {
            $response = Http::withOptions(["verify" => (bool) config("build.github.verify_ssl", true)])->withHeaders($this->headers())
                ->timeout((int) config('build.github.api_timeout', 30))
                ->post($url, [
                    'ref' => $this->ref,
                    'inputs' => $inputs,
                ]);
        } catch (\Throwable $e) {
            Log::error('[GitHubDispatch] dispatch transport error', ['error' => $e->getMessage(), 'url' => $url]);
            return false;
        }

        if ($response->successful()) {
            return true;
        }

        Log::error('[GitHubDispatch] dispatch failed', [
            'status' => $response->status(),
            'body' => $response->body(),
            'url' => $url,
        ]);
        return false;
    }

    /**
     * 通过 polling 根据 build_id（注入到 workflow inputs）定位 run_id。
     * GitHub API 不能按 inputs 查 run，兜底取最新 run。
     * 真生产环境应把 build_id 写入 workflow 的 run-name 或 artifact_name 来精确定位。
     */
    public function findLatestRunId(string $platform, int $maxAttempts = 12, int $sleepSeconds = 5): ?int
    {
        if (!$this->isConfigured()) {
            return null;
        }

        $workflow = $this->workflowFilename($platform);
        $url = "https://api.github.com/repos/{$this->repo}/actions/workflows/{$workflow}/runs";

        for ($i = 0; $i < $maxAttempts; $i++) {
            $response = Http::withOptions(["verify" => (bool) config("build.github.verify_ssl", true)])->withHeaders($this->headers())
                ->timeout(15)
                ->get($url, [
                    'event' => 'workflow_dispatch',
                    'branch' => $this->ref,
                    'per_page' => 5,
                ]);

            if ($response->successful()) {
                $runs = $response->json('workflow_runs', []);
                if (!empty($runs)) {
                    return (int) $runs[0]['id'];
                }
            }
            if ($i < $maxAttempts - 1) {
                sleep($sleepSeconds);
            }
        }

        return null;
    }

    /**
     * 取消 running 的 run。
     */
    public function cancelRun(int $runId): bool
    {
        if (!$this->isConfigured()) {
            return false;
        }

        $url = "https://api.github.com/repos/{$this->repo}/actions/runs/{$runId}/cancel";
        $response = Http::withOptions(["verify" => (bool) config("build.github.verify_ssl", true)])->withHeaders($this->headers())->timeout(15)->post($url);

        if ($response->successful()) {
            return true;
        }

        Log::warning('[GitHubDispatch] cancelRun failed', [
            'run_id' => $runId,
            'status' => $response->status(),
            'body' => $response->body(),
        ]);
        return false;
    }

    /**
     * 列出 run 的 artifacts。
     */
    public function listArtifacts(int $runId): array
    {
        if (!$this->isConfigured()) {
            return [];
        }

        $url = "https://api.github.com/repos/{$this->repo}/actions/runs/{$runId}/artifacts";
        $response = Http::withOptions(["verify" => (bool) config("build.github.verify_ssl", true)])->withHeaders($this->headers())->timeout(15)->get($url);

        return $response->successful() ? $response->json('artifacts', []) : [];
    }

    /**
     * 下载一个 artifact 的 zip 到指定本地路径（流式落盘，PHP 进程几乎不吃内存）。
     *
     * 0.3.2 改动：
     *  - 旧实现 `->get()->body()` 会把整个 artifact 加载进 PHP 内存（90+ MB → 200+ MB RSS），
     *    跨区慢网下 600 秒 timeout 经常一次跑不完，BuildWorker 永远拉不到。
     *  - 新实现用 Guzzle `sink` option 直接写文件，timeout 提到 1800 秒（30 分钟，可配），
     *    并加详细日志（开始/完成 + 实际耗时 + 平均速度 KB/s）。
     *
     * @return bool 成功 true，失败 false（失败时半成品文件已被清理）
     */
    public function downloadArtifact(int $artifactId, string $sinkPath): bool
    {
        if (!$this->isConfigured()) {
            Log::warning('[GitHubDispatch] download skipped: GitHub not configured', compact('artifactId'));
            return false;
        }

        $url = "https://api.github.com/repos/{$this->repo}/actions/artifacts/{$artifactId}/zip";

        @mkdir(dirname($sinkPath), 0755, true);
        @unlink($sinkPath);

        $startedAt = microtime(true);
        $timeout = (int) config('build.github.download_timeout', 1800);
        Log::info('[GitHubDispatch] download start', compact('artifactId', 'sinkPath', 'timeout'));

        try {
            $response = Http::withOptions([
                'verify' => (bool) config('build.github.verify_ssl', true),
                'sink' => $sinkPath,
            ])->withHeaders($this->headers())
              ->timeout($timeout)
              ->get($url);

            $elapsed = round(microtime(true) - $startedAt, 2);
            $size = file_exists($sinkPath) ? (int) filesize($sinkPath) : 0;

            if (!$response->successful()) {
                Log::error('[GitHubDispatch] download failed', [
                    'artifact_id' => $artifactId,
                    'status' => $response->status(),
                    'elapsed_s' => $elapsed,
                    'partial_size' => $size,
                ]);
                @unlink($sinkPath);
                return false;
            }

            Log::info('[GitHubDispatch] download done', [
                'artifact_id' => $artifactId,
                'size' => $size,
                'elapsed_s' => $elapsed,
                'speed_kbps' => $size > 0 && $elapsed > 0 ? round($size / 1024 / $elapsed, 1) : 0,
            ]);
            return true;
        } catch (\Throwable $e) {
            $elapsed = round(microtime(true) - $startedAt, 2);
            Log::error('[GitHubDispatch] download exception', [
                'artifact_id' => $artifactId,
                'msg' => $e->getMessage(),
                'elapsed_s' => $elapsed,
            ]);
            @unlink($sinkPath);
            return false;
        }
    }

    /**
     * 删除一个 artifact（双删的 GitHub 侧）。
     */
    public function deleteArtifact(int $artifactId): bool
    {
        if (!$this->isConfigured()) {
            return false;
        }

        $url = "https://api.github.com/repos/{$this->repo}/actions/artifacts/{$artifactId}";
        $response = Http::withOptions(["verify" => (bool) config("build.github.verify_ssl", true)])->withHeaders($this->headers())->timeout(15)->delete($url);

        return $response->successful();
    }
    /**
     * Upload a file to the repository via GitHub Contents API.
     * Returns the blob SHA on success, null on failure.
     */
    public function uploadFileToRepo(string $repoPath, string $fileContent, string $commitMessage = 'chore: upload build icon'): ?string
    {
        if (!$this->isConfigured()) {
            return null;
        }

        $url = "https://api.github.com/repos/{$this->repo}/contents/{$repoPath}";

        // Existence check via HEAD (no response body). The previous GET pulled the full
        // base64-encoded file content (~800KB for icons) just to read the SHA, which
        // repeatedly timed out on the slow server->GitHub link and bricked dispatch.
        // Icon paths are keyed by the unique build_id, so an existing blob is byte-identical
        // to what we are about to upload (left over from a prior attempt) -> skip the PUT.
        try {
            $head = Http::withOptions(["verify" => (bool) config("build.github.verify_ssl", true)])
                ->withHeaders($this->headers())
                ->timeout((int) config('build.github.api_timeout', 30))
                ->head($url . '?ref=' . rawurlencode($this->ref));

            if ($head->successful()) {
                Log::info('[GitHubDispatch] uploadFileToRepo skip (already exists on ref)', ['path' => $repoPath]);
                return 'exists';
            }

            $payload = [
                'message' => $commitMessage,
                'content' => base64_encode($fileContent),
                'branch' => $this->ref,
            ];

            $response = Http::withOptions(["verify" => (bool) config("build.github.verify_ssl", true)])
                ->withHeaders($this->headers())
                ->timeout((int) config('build.github.upload_timeout', 60))
                ->put($url, $payload);
        } catch (\Throwable $e) {
            Log::error('[GitHubDispatch] uploadFileToRepo transport error', ['path' => $repoPath, 'error' => $e->getMessage()]);
            return null;
        }

        if ($response->successful()) {
            Log::info('[GitHubDispatch] uploadFileToRepo ok', ['path' => $repoPath]);
            return $response->json('content.sha') ?: 'uploaded';
        }

        Log::error('[GitHubDispatch] uploadFileToRepo failed', [
            'path' => $repoPath,
            'status' => $response->status(),
            'body' => $response->body(),
        ]);
        return null;
    }

    /**
     * 确认某文件已在 ref（= $this->ref，通常 main）上可见。
     *
     * 用途：派发前确认刚 commit 的构建图标已传播到 ref HEAD。规避 GitHub 最终一致性竞态——
     * 图标刚 commit 到 main，紧接着 workflow_dispatch 解析 ref=main 时可能落到尚未含该图标的
     * 旧 HEAD，导致 workflow checkout 缺 .build-icons/{build_id}.png → inject ENOENT 整次失败。
     * 密集批量派发（一个 cron tick 连发多条）时尤其高发。
     */
    public function fileExistsOnRef(string $repoPath): bool
    {
        if (!$this->isConfigured()) {
            return false;
        }

        // HEAD instead of GET: the Contents API GET returns the full base64 file content
        // (~800KB for icons) which repeatedly times out on the slow link; HEAD only needs
        // the 200/404 status to confirm the blob exists on the ref. No body transferred.
        $url = "https://api.github.com/repos/{$this->repo}/contents/{$repoPath}";
        try {
            $resp = Http::withOptions(["verify" => (bool) config("build.github.verify_ssl", true)])
                ->withHeaders($this->headers())
                ->timeout((int) config('build.github.api_timeout', 30))
                ->head($url . '?ref=' . rawurlencode($this->ref));

            return $resp->successful();
        } catch (\Throwable $e) {
            Log::warning('[GitHubDispatch] fileExistsOnRef transport error', ['path' => $repoPath, 'error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Delete a file from the repository via GitHub Contents API.
     */
    public function deleteFileFromRepo(string $repoPath, string $commitMessage = 'chore: cleanup build icon'): bool
    {
        if (!$this->isConfigured()) {
            return false;
        }

        $url = "https://api.github.com/repos/{$this->repo}/contents/{$repoPath}";

        $existing = Http::withOptions(["verify" => (bool) config("build.github.verify_ssl", true)])
            ->withHeaders($this->headers())
            ->timeout(15)
            ->get($url, ['ref' => $this->ref]);

        if (!$existing->successful() || !$existing->json('sha')) {
            return false;
        }

        $response = Http::withOptions(["verify" => (bool) config("build.github.verify_ssl", true)])
            ->withHeaders($this->headers())
            ->timeout(15)
            ->delete($url, [
                'message' => $commitMessage,
                'sha' => $existing->json('sha'),
                'branch' => $this->ref,
            ]);

        return $response->successful();
    }

}
