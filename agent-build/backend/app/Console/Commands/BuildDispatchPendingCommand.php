<?php

namespace App\Console\Commands;

use App\Services\Build\GitHubDispatchService;
use App\Services\Build\QuotaService;
use App\Services\Build\BuildDispatchPause;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * 0.3.3 起：异步 dispatch worker。
 *
 * 旧实现（0.3.2 及以下）：BuildRequestController::request 同步调用 GitHub Actions
 * workflow_dispatch（含 15s timeout），跨区慢网下整端点常耗时 5-15+s，
 * agent-admin 默认 15s timeout 容易超时 → 客户云控端任务在列表里「消失」。
 *
 * 新实现：request 仅插行（status='pending'），本 cron 每分钟扫 pending 行
 * 调 GitHub Actions。成功 → queued；失败 → 累加 attempts，3 次仍失败 → failed +
 * 退配额。乐观锁防并发（status='pending' AND dispatch_attempts=$old → ++）。
 *
 * 与 BuildWorker 协作：
 *   - BuildDispatchPending：处理 pending → queued/failed
 *   - BuildWorker：处理 queued/building → success/failed（拉 GitHub artifact）
 *   - BuildAckTimeout：处理 success → expired（云控端长期未 ack）
 *   - BuildStuckDetector：处理 building 卡死的行
 */
class BuildDispatchPendingCommand extends Command
{
    protected $signature = 'build:dispatch-pending';

    protected $description = '扫描 status=pending 的 build_requests 异步 dispatch 到 GitHub Actions（0.3.3 起替代同步 dispatch）';

    private const MAX_ATTEMPTS = 3;
    private const BATCH_SIZE = 5;

    /**
     * 图标 commit 后、派发前确认其在 ref 上可见的轮询参数（防 GitHub 最终一致性竞态）。
     * 每次先 sleep 再查：既给 GitHub 传播留间隔（避免密集批量派发抢在图标可见前解析 ref），
     * 又确认图标确已在 ref 上。RETRIES × SLEEP 即最坏等待（4 × 2s = 8s）。
     */
    private const ICON_PROPAGATION_RETRIES = 4;
    private const ICON_PROPAGATION_SLEEP_US = 2000000; // 2s

    public function handle(GitHubDispatchService $github, QuotaService $quota): int
    {
        $startedAt = microtime(true);
        $this->info('[BuildDispatchPending] started at ' . date('Y-m-d H:i:s'));

        if (\App\Services\Build\BuildPackaging::retired()) {
            $this->warn('[BuildPackaging] retired, skip');
            return 0;
        }

        if (BuildDispatchPause::paused()) {
            $this->warn('[BuildDispatchPending] dispatch paused, skip');
            return 0;
        }

        if (!$github->isConfigured()) {
            $this->warn('[BuildDispatchPending] GitHub not configured, skip');
            return 0;
        }

        $pending = DB::table('build_requests')
            ->where('status', 'pending')
            ->where('dispatch_attempts', '<', self::MAX_ATTEMPTS)
            ->orderBy('queued_at', 'asc')
            ->limit(self::BATCH_SIZE)
            ->get();

        if ($pending->isEmpty()) {
            $this->info('[BuildDispatchPending] no pending builds');
            return 0;
        }

        $dispatched = 0;
        $retried = 0;
        $failed = 0;

        foreach ($pending as $build) {
            $outcome = $this->dispatchOne($build, $github, $quota);
            if ($outcome === 'dispatched') {
                $dispatched++;
            } elseif ($outcome === 'failed') {
                $failed++;
            } else {
                $retried++;
            }
        }

        $elapsed = round(microtime(true) - $startedAt, 2);
        $this->info("[BuildDispatchPending] done dispatched={$dispatched} retried={$retried} failed={$failed} elapsed={$elapsed}s");
        return 0;
    }

    /**
     * 处理单条 pending 行。
     * 返回：'dispatched' / 'retried' / 'failed'。
     */
    private function dispatchOne($build, GitHubDispatchService $github, QuotaService $quota): string
    {
        $now = now();

        // 乐观锁：原子地把 dispatch_attempts++（防多 worker 并发同一行）
        $newAttempts = (int) $build->dispatch_attempts + 1;
        $rowsAffected = DB::table('build_requests')
            ->where('build_id', $build->build_id)
            ->where('status', 'pending')
            ->where('dispatch_attempts', $build->dispatch_attempts)
            ->update([
                'dispatch_attempts' => $newAttempts,
                'updated_at' => $now,
            ]);

        if ($rowsAffected === 0) {
            $this->info("[BuildDispatchPending] skipped (raced or status changed) build_id={$build->build_id}");
            return 'retried';
        }

        // Safety net: wrap the whole dispatch attempt so any uncaught transport/runtime
        // error cannot silently weld the build. dispatch_attempts was already incremented
        // above; once it reaches MAX_ATTEMPTS the dispatch query (attempts < MAX) would
        // never select the row again -> permanent 'pending'. The catch converts that into
        // a visible terminal state (failed + quota refund) once attempts are exhausted.
        try {

        // 拿 client + 拼 dispatch inputs
        $client = DB::table('authorized_clients')->where('client_id', $build->client_id)->first();
        if (!$client) {
            DB::table('build_requests')->where('build_id', $build->build_id)->update([
                'status' => 'failed',
                'error_message' => 'client_not_found_at_dispatch',
                'finished_at' => $now,
                'updated_at' => $now,
            ]);
            $this->error("[BuildDispatchPending] client_id={$build->client_id} not found, marked failed build_id={$build->build_id}");
            Log::error('[BuildDispatchPending] client missing', [
                'build_id' => $build->build_id,
                'client_id' => $build->client_id,
            ]);
            return 'failed';
        }

        $callbackUrl = rtrim((string) config('app.url'), '/') . '/api/build/callback';
        // Download icon from cloud control and upload to GitHub repo
        $iconRepoPath = '.build-icons/' . $build->build_id . '.png';
        $iconContent = $this->downloadIcon($build->icon_path);
        if (!$iconContent) {
            Log::warning('[BuildDispatchPending] icon download failed', [
                'build_id' => $build->build_id,
                'icon_url' => $build->icon_path,
            ]);
            // Mark as retryable - don't fail permanently for transient network issues
            if ($newAttempts >= self::MAX_ATTEMPTS) {
                DB::table('build_requests')->where('build_id', $build->build_id)->update([
                    'status' => 'failed',
                    'error_message' => 'icon_download_failed_after_' . self::MAX_ATTEMPTS . '_attempts',
                    'finished_at' => $now,
                    'updated_at' => $now,
                ]);
                $today = date('Y-m-d', strtotime((string) $build->created_at));
                $quota->decrDailyCount($build->client_id, $today);
                $this->error("[BuildDispatchPending] icon download failed after {$newAttempts} attempts build_id={$build->build_id}");
                return 'failed';
            }
            $this->warn("[BuildDispatchPending] icon download failed, will retry build_id={$build->build_id}");
            return 'retried';
        }

        // 图标内容兜底校验：必须是真实 PNG 且 512–1024 正方形（与 inject-build-params.js validatePng 对齐）。
        // 防止云控端漏校验（如未升级的老版本客户端）把 JPEG/非 PNG 传到 GitHub —— 那样会浪费整次
        // Actions 配额且只在 CI 里报晦涩的 magic mismatch。这里属内容问题，不重试，直接判失败并写清原因。
        $iconError = $this->validateIconBytes($iconContent);
        if ($iconError !== null) {
            DB::table('build_requests')->where('build_id', $build->build_id)->update([
                'status' => 'failed',
                'error_message' => $iconError,
                'finished_at' => $now,
                'updated_at' => $now,
            ]);
            $today = date('Y-m-d', strtotime((string) $build->created_at));
            $quota->decrDailyCount($build->client_id, $today);
            $this->error("[BuildDispatchPending] icon invalid ({$iconError}) build_id={$build->build_id}");
            Log::warning('[BuildDispatchPending] icon invalid (non-PNG or bad dimensions)', [
                'build_id' => $build->build_id,
                'reason' => $iconError,
            ]);
            return 'failed';
        }

        // Shrink the icon to 512x512 so the GitHub PUT upload stays small on the slow link.
        $iconContent = $this->downscaleIconTo512($iconContent);

        $uploadedSha = $github->uploadFileToRepo($iconRepoPath, $iconContent, "chore: build icon {$build->build_id}");
        if (!$uploadedSha) {
            // 达到上限仍失败 → 标 failed + 退配额（与 dispatch 失败分支一致）。
            // 修复：旧实现此处只 return 'retried' 不判上限，attempts=3 后仍 status=pending，
            // 而派发查询条件 dispatch_attempts<3 不再捞它 → 永久卡 pending（StuckDetector 只管 building）。
            if ($newAttempts >= self::MAX_ATTEMPTS) {
                DB::table('build_requests')->where('build_id', $build->build_id)->update([
                    'status' => 'failed',
                    'error_message' => 'icon_upload_failed_after_' . self::MAX_ATTEMPTS . '_attempts',
                    'finished_at' => $now,
                    'updated_at' => $now,
                ]);
                $today = date('Y-m-d', strtotime((string) $build->created_at));
                $quota->decrDailyCount($build->client_id, $today);
                $this->error("[BuildDispatchPending] icon upload failed after {$newAttempts} attempts, refunded quota build_id={$build->build_id}");
                Log::warning('[BuildDispatchPending] icon upload failed (max attempts reached)', [
                    'build_id' => $build->build_id,
                    'attempts' => $newAttempts,
                ]);
                return 'failed';
            }
            $this->warn("[BuildDispatchPending] icon upload to repo failed, will retry build_id={$build->build_id}");
            return 'retried';
        }

        $dispatchInputs = [
            'build_id' => $build->build_id,
            'app_name' => $build->app_name,
            'domain' => $client->domain,
            'api_domain' => $client->domain,
            'icon_path' => $iconRepoPath,
            // 云端原始图标 URL（= build_request.icon_path，云控端公开 url）。
            // 传给 workflow 作 inject 的兜底下载源：若仓库里 commit 的图标因竞态在 checkout 时缺失，
            // inject 会改从此 URL 下载，构建不再因 .build-icons/{id}.png ENOENT 而失败。
            'icon_url' => (string) $build->icon_path,
            'callback_url' => $callbackUrl,
            'callback_token' => $build->callback_token,
        ];

        $buildMode = (string) ($build->build_mode ?? 'normal');
        if ($buildMode === 'oem') {
            $updateUrl = rtrim((string) $client->domain, '/') . (string) $build->update_path;
            $dispatchInputs['app_id'] = (string) $build->app_id;
            $dispatchInputs['update_url'] = $updateUrl;
            $dispatchInputs['app_version'] = (string) $build->app_version;
            $dispatchInputs['build_mode'] = 'oem';
            $dispatchInputs['oem_project_key'] = (string) $build->oem_project_key;
            if (!empty($build->build_options)) {
                $dispatchInputs['build_options'] = (string) $build->build_options;
            }
        }

        // 派发前确认图标已在 ref 上可见（防 GitHub 最终一致性竞态）：
        // 图标刚 commit 到 main、紧接着 workflow_dispatch 解析 ref=main 时可能落到尚未含图标的
        // 旧 HEAD，workflow checkout 缺 .build-icons/{build_id}.png → inject ENOENT 整次失败。
        // 一个 cron tick 连发多条时尤其高发。先 sleep 留传播间隔再查，确认可见后才派发；
        // 始终未可见则本次不派发、下一轮 cron 重试（不浪费 GitHub Actions 配额跑必败的构建）。
        $iconVisible = false;
        for ($i = 0; $i < self::ICON_PROPAGATION_RETRIES; $i++) {
            usleep(self::ICON_PROPAGATION_SLEEP_US);
            if ($github->fileExistsOnRef($iconRepoPath)) {
                $iconVisible = true;
                break;
            }
        }
        if (!$iconVisible) {
            // 达到上限仍不可见 → 标 failed + 退配额（避免永久卡 pending，同 icon 上传失败分支）。
            if ($newAttempts >= self::MAX_ATTEMPTS) {
                DB::table('build_requests')->where('build_id', $build->build_id)->update([
                    'status' => 'failed',
                    'error_message' => 'icon_not_visible_on_ref_after_' . self::MAX_ATTEMPTS . '_attempts',
                    'finished_at' => $now,
                    'updated_at' => $now,
                ]);
                $today = date('Y-m-d', strtotime((string) $build->created_at));
                $quota->decrDailyCount($build->client_id, $today);
                $this->error("[BuildDispatchPending] icon not visible after {$newAttempts} attempts, refunded quota build_id={$build->build_id}");
                Log::warning('[BuildDispatchPending] icon not visible on ref (max attempts reached)', [
                    'build_id' => $build->build_id,
                    'icon_path' => $iconRepoPath,
                ]);
                return 'failed';
            }
            $this->warn("[BuildDispatchPending] icon not yet visible on ref after upload, will retry build_id={$build->build_id}");
            Log::warning('[BuildDispatchPending] icon not visible on ref pre-dispatch', [
                'build_id' => $build->build_id,
                'icon_path' => $iconRepoPath,
            ]);
            return 'retried';
        }

        $dispatched = $github->dispatch($build->platform, $dispatchInputs);

        if ($dispatched) {
            DB::table('build_requests')->where('build_id', $build->build_id)->update([
                'status' => 'queued',
                'dispatched_at' => $now,
                'updated_at' => $now,
            ]);
            $this->info("[BuildDispatchPending] dispatched build_id={$build->build_id} attempts={$newAttempts}");
            Log::info('[BuildDispatchPending] dispatched', [
                'build_id' => $build->build_id,
                'attempts' => $newAttempts,
            ]);
            return 'dispatched';
        }

        // dispatch 失败：达到上限 → 标记 failed + 退配额
        if ($newAttempts >= self::MAX_ATTEMPTS) {
            DB::table('build_requests')->where('build_id', $build->build_id)->update([
                'status' => 'failed',
                'error_message' => 'github_dispatch_failed_after_' . self::MAX_ATTEMPTS . '_attempts',
                'finished_at' => $now,
                'updated_at' => $now,
            ]);
            $today = date('Y-m-d', strtotime((string) $build->created_at));
            $quota->decrDailyCount($build->client_id, $today);
            $this->error("[BuildDispatchPending] failed after {$newAttempts} attempts, refunded quota build_id={$build->build_id}");
            Log::warning('[BuildDispatchPending] dispatch failed (max attempts reached)', [
                'build_id' => $build->build_id,
                'attempts' => $newAttempts,
            ]);
            return 'failed';
        }

        // 仍有重试机会，保留 pending（attempts 已累加，下次 cron 还会捞）
        $this->warn("[BuildDispatchPending] dispatch failed, will retry build_id={$build->build_id} attempts={$newAttempts}/" . self::MAX_ATTEMPTS);
        Log::warning('[BuildDispatchPending] dispatch failed (will retry)', [
            'build_id' => $build->build_id,
            'attempts' => $newAttempts,
        ]);
        return 'retried';
        } catch (\Throwable $e) {
            $errNow = now();
            Log::error('[BuildDispatchPending] dispatch exception', [
                'build_id' => $build->build_id,
                'attempts' => $newAttempts,
                'error' => $e->getMessage(),
            ]);
            if ($newAttempts >= self::MAX_ATTEMPTS) {
                DB::table('build_requests')->where('build_id', $build->build_id)
                    ->where('status', 'pending')
                    ->update([
                        'status' => 'failed',
                        'error_message' => 'dispatch_exception_after_' . self::MAX_ATTEMPTS . '_attempts: ' . mb_substr((string) $e->getMessage(), 0, 180),
                        'finished_at' => $errNow,
                        'updated_at' => $errNow,
                    ]);
                $today = date('Y-m-d', strtotime((string) $build->created_at));
                $quota->decrDailyCount($build->client_id, $today);
                $this->error("[BuildDispatchPending] exception after {$newAttempts} attempts, marked failed build_id={$build->build_id}");
                return 'failed';
            }
            $this->warn("[BuildDispatchPending] exception, will retry build_id={$build->build_id} attempts={$newAttempts}");
            return 'retried';
        }
    }
    /**
     * Download icon from URL (agent-build server can reach cloud control reliably).
     * Returns raw file content or null on failure.
     */
    private function downloadIcon(string $url): ?string
    {
        try {
            $response = \Illuminate\Support\Facades\Http::withOptions([
                'verify' => (bool) config('build.github.verify_ssl', true),
            ])->timeout(30)->get($url);

            if ($response->successful()) {
                return $response->body();
            }

            Log::warning('[BuildDispatchPending] icon download HTTP error', [
                'url' => $url,
                'status' => $response->status(),
            ]);
            return null;
        } catch (\Throwable $e) {
            Log::warning('[BuildDispatchPending] icon download exception', [
                'url' => $url,
                'error' => $e->getMessage(),
            ]);
            return null;
        }
    }

    /**
     * Downscale a square PNG icon to 512x512 before committing it to the GitHub repo.
     * The source is already validated as a square PNG of 512-1024px (see validateIconBytes),
     * but at the high end it can be ~600KB-2MB, and on the slow server->GitHub link a large
     * PUT upload risks timing out. 512x512 is a standard app-icon base size and keeps the
     * blob much smaller (roughly halved for typical icons; far less for flat ones). Safe
     * no-op when GD is unavailable, the bytes are not a valid
     * image, or the image is already <=512px. PNG alpha transparency is preserved.
     */
    private function downscaleIconTo512(string $bytes): string
    {
        if (!function_exists('imagecreatefromstring')) {
            return $bytes; // GD not available -> leave untouched
        }
        $info = @getimagesizefromstring($bytes);
        if (!$info) {
            return $bytes;
        }
        [$w, $h] = $info;
        if ((int) $w <= 512 && (int) $h <= 512) {
            return $bytes; // already small enough, avoid a needless re-encode
        }

        $src = @imagecreatefromstring($bytes);
        if (!$src) {
            return $bytes;
        }
        $dst = imagecreatetruecolor(512, 512);
        // Preserve PNG alpha transparency
        imagealphablending($dst, false);
        imagesavealpha($dst, true);
        $transparent = imagecolorallocatealpha($dst, 0, 0, 0, 127);
        imagefilledrectangle($dst, 0, 0, 512, 512, $transparent);
        imagecopyresampled($dst, $src, 0, 0, 0, 0, 512, 512, (int) $w, (int) $h);

        ob_start();
        $ok = imagepng($dst, null, 9); // max zlib compression
        $out = ob_get_clean();
        imagedestroy($src);
        imagedestroy($dst);

        if ($ok && is_string($out) && strlen($out) > 0) {
            Log::info('[BuildDispatchPending] icon downscaled to 512x512', [
                'from' => "{$w}x{$h}",
                'orig_bytes' => strlen($bytes),
                'new_bytes' => strlen($out),
            ]);
            return $out;
        }
        return $bytes;
    }

    /**
     * 图标内容兜底校验：真实 PNG + 512×512–1024×1024 + 正方形。
     * 与 inject-build-params.js validatePng / 云控端 CloudBuildIconValidator 规则对齐。
     * getimagesizefromstring 属 PHP 核心函数，不依赖 GD 扩展。
     *
     * @return string|null null=合规；否则返回面向用户的中文失败原因。
     */
    private function validateIconBytes(string $bytes): ?string
    {
        if (strlen($bytes) > 2 * 1024 * 1024) {
            return '图标超过 2MB';
        }
        // PNG 魔数：89 50 4E 47 0D 0A 1A 0A
        if (strlen($bytes) < 24 || substr($bytes, 0, 8) !== "\x89PNG\r\n\x1a\n") {
            return '图标必须是 PNG 格式（当前文件不是 PNG，例如 JPG/WEBP 不被接受）';
        }
        $info = @getimagesizefromstring($bytes);
        if (!$info || ($info[2] ?? null) !== IMAGETYPE_PNG) {
            return '图标必须是 PNG 格式（当前文件不是有效 PNG）';
        }
        [$w, $h] = $info;
        if ((int) $w !== (int) $h) {
            return "图标必须是 1:1 正方形（当前为 {$w}×{$h}）";
        }
        if ($w < 512 || $w > 1024 || $h < 512 || $h > 1024) {
            return "图标尺寸必须在 512×512 至 1024×1024 之间（当前为 {$w}×{$h}）";
        }
        return null;
    }

}
