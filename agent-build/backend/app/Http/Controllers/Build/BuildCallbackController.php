<?php

namespace App\Http\Controllers\Build;

use App\Http\Controllers\Controller;
use App\Services\Build\BuildWakeService;
use App\Services\Build\QuotaService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class BuildCallbackController extends Controller
{
    /**
     * POST /api/build/callback
     * Header: Authorization: Bearer <callback_token>
     *
     * 0.5.0 起 GitHub Actions workflow 把产物上传到 GitHub Release 后回调，body：
     * {
     *   "build_id": "...",
     *   "run_id": 12345,
     *   "status": "success",
     *   "artifact_storage": "github_release",
     *   "release_tag": "build-{build_id}",
     *   "files": [
     *     {"filename":"app-1.0.0-setup.exe","asset_id":12345678,"asset_url":"https://api.github.com/.../assets/12345678",
     *      "size":..., "sha256":"...", "role":"primary"},
     *     {"filename":"app-1.0.0-setup.exe.blockmap", "asset_id":..., ..., "role":"blockmap"},
     *     {"filename":"latest.yml", "asset_id":..., ..., "role":"metadata"}
     *   ]
     * }
     *
     * 不在此处 wake 云控端：mirror_url 还没就绪（mirror_status='pending'），云控端来拉
     * 也只能拿到 425 not_ready。等 MirrorWorkerController.ack 阶段（家庭电脑 SFTP 推完）
     * 再 wake，确保云控端拉的时候立刻能拿到 mirror_url_primary。
     *
     * 0.5.0 起：artifact_storage 必须为 'github_release'，旧 cos / 旧 GitHub artifact
     * 路径已删（与跨境 COS 上传退役同步进行）。
     */
    public function callback(Request $request, QuotaService $quota, BuildWakeService $wake): JsonResponse
    {
        $authHeader = $request->header('Authorization');
        if (!$authHeader || !str_starts_with($authHeader, 'Bearer ')) {
            return response()->json(['error' => 'missing_bearer'], 401);
        }
        $token = substr($authHeader, 7);

        $buildId = $request->input('build_id');
        if (!$buildId) {
            return response()->json(['error' => 'build_id_required'], 400);
        }

        $build = DB::table('build_requests')->where('build_id', $buildId)->first();
        if (!$build) {
            return response()->json(['error' => 'build_not_found'], 404);
        }

        if (!$build->callback_token || !hash_equals($build->callback_token, $token)) {
            return response()->json(['error' => 'invalid_callback_token'], 401);
        }

        $status = $request->input('status');
        $runId = $request->input('run_id');
        $now = now();
        $wasFailed = $build->status === 'failed';

        // 0.3.2: GitHub Actions re-run 友好性 —— 保留 callback_token，同状态重复 callback
        // 不重复退还配额（首次 failed 才退）。

        // 0.17.1: 补齐 re-run 友好性的另一半 —— build 一旦进入 mirror 流水线（家庭电脑
        // 已领取 / 已镜像 / 已清理），GHA re-run 重放的任何回调都是过期消息，直接幂等 ack。
        // 否则重放会把 mirroring/mirrored 无条件重置回 mirror_status='pending'：
        //  - worker 随后 ack 撞 409（pending 不在 ack 幂等白名单），4 次重试耗尽后调 fail，
        //    而 fail 白名单恰好放行 pending → 已镜像成功的 build 被标 failed + 退配额；
        //  - 已 purge 的 build 被复活成 pending，但其 GitHub Release 早已删除，必然失败。
        // mirror_status='pending'/'failed'/NULL 时不拦：worker 尚未领取或已失败，
        // re-run 重新上传产物后重放回调属合法恢复路径。
        $mirrorStatus = (string) ($build->mirror_status ?? '');
        if (in_array($mirrorStatus, ['mirroring', 'mirrored', 'purging', 'purged'], true)) {
            Log::info('[BuildCallback] stale callback ignored (build already in mirror pipeline)', [
                'build_id' => $buildId,
                'mirror_status' => $mirrorStatus,
                'callback_status' => $status,
                'run_id' => $runId,
            ]);
            return response()->json(['ack' => true, 'idempotent' => true], 200);
        }

        // GHA 失败分支
        if ($status !== 'success') {
            DB::table('build_requests')->where('build_id', $buildId)->update([
                'status' => 'failed',
                'finished_at' => $now,
                'executor_run_id' => $runId,
                'error_message' => $request->input('error') ?: 'unknown',
                'updated_at' => $now,
            ]);

            if (!$wasFailed) {
                $createdDate = date('Y-m-d', strtotime($build->created_at));
                $quota->decrDailyCount($build->client_id, $createdDate);
            }

            // 0.4.1: 失败也发 wake，让云控端立即同步 status=failed（不然 admin UI 卡「排队中」
            // 直到 cloud-build:pull cron 每分钟兜底）
            $this->wakeClientBestEffort($wake, $build->client_id, $buildId, 'on_gha_failure');
            return response()->json(['ack' => true], 200);
        }

        // GHA success 分支：必须 artifact_storage='github_release'
        $storage = (string) $request->input('artifact_storage', '');
        if ($storage !== 'github_release') {
            $this->markFailure($build, $runId, 'unsupported_artifact_storage:' . $storage, $now, $wasFailed, $quota);
            Log::error('[BuildCallback] unsupported artifact_storage', [
                'build_id' => $buildId,
                'received' => $storage,
            ]);
            $this->wakeClientBestEffort($wake, $build->client_id, $buildId, 'on_unsupported_storage');
            return response()->json(['error' => 'unsupported_artifact_storage', 'received' => $storage], 422);
        }

        return $this->handleGithubReleaseSuccess($build, $request, $quota, $now, $wasFailed);
    }

    /**
     * 处理 GitHub Release callback：
     *  - 校验 release_tag 必为 "build-{build_id}"（防伪 + 后续家庭电脑找 release 用）
     *  - 校验每个 file 必填项（filename / role / asset_id / asset_url）
     *  - 不做远程 HEAD（GHA 已上传成功才会回调；家庭电脑下载阶段会再校验 sha256）
     *  - 落库 status='success' + mirror_status='pending'，等家庭电脑领取
     */
    private function handleGithubReleaseSuccess(
        object $build,
        Request $request,
        QuotaService $quota,
        $now,
        bool $wasFailed
    ): JsonResponse {
        $buildId = $build->build_id;
        $runId = $request->input('run_id');
        $releaseTag = (string) $request->input('release_tag', '');
        $files = $request->input('files');

        $expectedTag = "build-{$buildId}";
        if ($releaseTag !== $expectedTag) {
            $this->markFailure($build, $runId, 'release_tag_mismatch', $now, $wasFailed, $quota);
            Log::error('[BuildCallback] release_tag_mismatch', [
                'build_id' => $buildId,
                'expected' => $expectedTag,
                'received' => $releaseTag,
            ]);
            return response()->json(['error' => 'release_tag_mismatch'], 422);
        }

        if (!is_array($files) || empty($files)) {
            $this->markFailure($build, $runId, 'release_files_empty', $now, $wasFailed, $quota);
            return response()->json(['error' => 'release_files_empty'], 422);
        }

        $primary = null;
        $allowedRoles = ['primary', 'blockmap', 'metadata'];
        $cleanFiles = [];           // artifact_files JSON：主件 + 副件，给 download() 复用
        $cleanReleaseAssets = [];   // release_assets JSON：含 asset_id / asset_url，给家庭电脑下载用

        foreach ($files as $f) {
            if (!is_array($f) || empty($f['filename']) || empty($f['role'])) {
                $this->markFailure($build, $runId, 'release_files_malformed', $now, $wasFailed, $quota);
                return response()->json(['error' => 'release_files_malformed'], 422);
            }
            $role = (string) $f['role'];
            if (!in_array($role, $allowedRoles, true)) {
                $this->markFailure($build, $runId, 'release_files_invalid_role', $now, $wasFailed, $quota);
                return response()->json(['error' => 'release_files_invalid_role'], 422);
            }
            $filename = (string) $f['filename'];
            // 防越权：filename 不能含 / 或 ..
            if (str_contains($filename, '/') || str_contains($filename, '..')) {
                $this->markFailure($build, $runId, 'release_filename_invalid', $now, $wasFailed, $quota);
                return response()->json(['error' => 'release_filename_invalid'], 422);
            }

            // asset_id 接受 int（REST API numeric id，如 416817002）或 string（GraphQL node_id，如
            // "RA_kwDOSTV3Rc4Y2B9q"）。GitHub CLI `gh release view --json assets` 返回的 id 是 node_id，
            // 而 REST API /releases/{id}/assets 返回的是 int。两种都允许通过，原值落库即可，
            // 因为下游 mirror worker 用 asset_url 直接下载，不解析 asset_id。
            $assetIdRaw = $f['asset_id'] ?? null;
            $assetUrl = (string) ($f['asset_url'] ?? '');
            $assetIdValid = (is_int($assetIdRaw) && $assetIdRaw > 0)
                || (is_string($assetIdRaw) && $assetIdRaw !== '');
            if (!$assetIdValid || $assetUrl === '') {
                $this->markFailure($build, $runId, 'release_asset_missing', $now, $wasFailed, $quota);
                return response()->json(['error' => 'release_asset_missing', 'filename' => $filename], 422);
            }
            $assetId = $assetIdRaw;

            $row = [
                'filename' => $filename,
                'relative_path' => $buildId . '/' . $filename,
                'size' => (int) ($f['size'] ?? 0),
                'sha256' => (string) ($f['sha256'] ?? ''),
                'role' => $role,
            ];
            $cleanFiles[] = $row;

            $cleanReleaseAssets[] = [
                'filename' => $filename,
                'asset_id' => $assetId,
                'asset_url' => $assetUrl,
                'size' => (int) ($f['size'] ?? 0),
                'sha256' => (string) ($f['sha256'] ?? ''),
                'role' => $role,
            ];

            if ($role === 'primary' && $primary === null) {
                $primary = $row;
            }
        }

        if ($primary === null) {
            $this->markFailure($build, $runId, 'release_primary_not_found', $now, $wasFailed, $quota);
            return response()->json(['error' => 'release_primary_not_found'], 422);
        }

        // 落库 success + mirror_status='pending'，等家庭电脑来领。
        DB::table('build_requests')->where('build_id', $buildId)->update([
            'status' => 'success',
            'finished_at' => $now,
            'executor_run_id' => $runId,
            'artifact_path' => $primary['relative_path'],
            'artifact_size' => $primary['size'],
            'artifact_sha256' => $primary['sha256'],
            'artifact_files' => json_encode($cleanFiles, JSON_UNESCAPED_SLASHES),
            'release_tag' => $releaseTag,
            'release_assets' => json_encode($cleanReleaseAssets, JSON_UNESCAPED_SLASHES),
            'mirror_status' => 'pending',
            'error_message' => null,
            'updated_at' => $now,
        ]);

        Log::info('[BuildCallback] github release success → mirror pending', [
            'build_id' => $buildId,
            'run_id' => $runId,
            'release_tag' => $releaseTag,
            'files_count' => count($cleanFiles),
            'primary' => $primary['filename'],
        ]);

        // 不在此处 wake：mirror_url 就绪后由 MirrorWorkerController.ack wake。
        return response()->json(['ack' => true], 200);
    }

    /**
     * 把当前 build 强转 failed + 退配额（仅首次失败）。
     */
    private function markFailure(
        object $build,
        $runId,
        string $errorCode,
        $now,
        bool $wasFailed,
        QuotaService $quota
    ): void {
        // 复查修正：同步设 mirror_status='failed'，避免 status=failed 但 mirror_status=NULL
        // 状态机不自洽（home worker 不会去领它，但 download API 仍可能返 not_ready 425）。
        DB::table('build_requests')->where('build_id', $build->build_id)->update([
            'status' => 'failed',
            'mirror_status' => 'failed',
            'finished_at' => $now,
            'executor_run_id' => $runId,
            'error_message' => $errorCode,
            'updated_at' => $now,
        ]);

        if (!$wasFailed) {
            $createdDate = date('Y-m-d', strtotime($build->created_at));
            $quota->decrDailyCount($build->client_id, $createdDate);
        }
    }

    /**
     * GHA 失败 / artifact_storage 不识别时同步通知云控端，避免 admin UI 卡「排队中」。
     */
    private function wakeClientBestEffort(BuildWakeService $wake, string $clientId, string $buildId, string $reason): void
    {
        try {
            $client = DB::table('authorized_clients')->where('client_id', $clientId)->first();
            if ($client) {
                $wake->wakeClient($client, $buildId);
            }
        } catch (\Throwable $e) {
            Log::warning('[BuildCallback] wake exception (non-blocking)', [
                'build_id' => $buildId,
                'reason' => $reason,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
