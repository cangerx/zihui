<?php

namespace App\Services\CloudBuild;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Cloud-build artifact pull pipeline. 1.2.0 起从 push 模型改为 pull 模型，
 * 此 service 是核心调度层，被以下两处调用：
 *   1) CloudBuildPullArtifact 命令（cron 模式：每分钟批量处理）
 *   2) CloudBuildController::refresh 端点（按需模式：详情页打开/刷新时单条触发）
 *
 * 单条 pullOne 与批量 pullPending 共用相同 resolve→download→place→ack 流水。
 */
class CloudBuildPullService
{
    public function __construct(
        private AgentBuildClient $sdk,
        private ArtifactDownloadService $download,
        private UpdateDirService $dir,
        private CloudBuildBackendSelector $selector,
        private CloudBuildLocalDeliveryService $local,
        private ?CloudBuildCutoverStore $cutover = null,
    ) {}

    /**
     * 处理单条 build。返回结果数组：
     *   ['outcome' => 'delivered'|'in_progress'|'not_found'|'expired'|'failed'|'skipped', 'message' => string, 'row' => stdClass|null]
     */
    public function pullOne(string $buildId): array
    {
        if ($this->cutover?->workersPaused()) {
            return ['outcome' => 'skipped', 'message' => 'workers_paused', 'row' => null];
        }

        if ($this->selector->usesLocal()) {
            return $this->local->deliver('cloud_builds', $buildId);
        }

        $b = DB::table('cloud_builds')->where('build_id', $buildId)->first();
        if (!$b) {
            return ['outcome' => 'not_found', 'message' => 'cloud_build_not_found', 'row' => null];
        }

        // 已终态直接返回
        if (in_array($b->status, ['delivered'])) {
            return ['outcome' => 'delivered', 'message' => 'already_delivered', 'row' => $b];
        }
        if (in_array($b->status, ['failed', 'cancelled', 'expired', 'purged'])) {
            return ['outcome' => $b->status, 'message' => (string) ($b->error_message ?? ''), 'row' => $b];
        }

        // 阶段 1：URL 还没有就先 resolve
        if (empty($b->agent_build_url) || empty($b->sha256)) {
            $resolved = $this->tryResolveDownload($b);
            if (!$resolved) {
                $b = DB::table('cloud_builds')->where('id', $b->id)->first();
                return ['outcome' => 'in_progress', 'message' => 'awaiting_artifact', 'row' => $b];
            }
            $b = DB::table('cloud_builds')->where('id', $b->id)->first();
        }

        // 阶段 2：已经有 URL，下载 + 落盘 + ack
        $ok = $this->downloadAndPlace($b);
        $b = DB::table('cloud_builds')->where('id', $b->id)->first();
        if ($ok) {
            return ['outcome' => 'delivered', 'message' => 'just_delivered', 'row' => $b];
        }
        if ($b && $b->status === 'downloading') {
            return ['outcome' => 'in_progress', 'message' => 'download_in_progress', 'row' => $b];
        }
        if ($b && in_array($b->status, ['delivered', 'failed', 'cancelled', 'expired', 'purged'], true)) {
            return ['outcome' => $b->status, 'message' => (string) ($b->error_message ?? ''), 'row' => $b];
        }
        return ['outcome' => 'failed', 'message' => (string) ($b->error_message ?? 'unknown'), 'row' => $b];
    }

    /**
     * 管理员重试。本地 backend 走显式 requeue；远端仍重置投影后 pull。
     *
     * @return array{outcome:string,message:string,row:?object}
     */
    public function retryOne(string $buildId): array
    {
        if ($this->cutover?->workersPaused()) {
            return ['outcome' => 'skipped', 'message' => 'workers_paused', 'row' => null];
        }

        if ($this->selector->usesLocal()) {
            return $this->local->requeue('cloud_builds', $buildId);
        }

        $b = DB::table('cloud_builds')->where('build_id', $buildId)->first();
        if (!$b) {
            return ['outcome' => 'not_found', 'message' => 'cloud_build_not_found', 'row' => null];
        }
        if (!in_array((string) $b->status, ['failed', 'expired', 'cancelled'], true)) {
            return ['outcome' => 'failed', 'message' => 'not_retryable', 'row' => $b];
        }

        $newStatus = !empty($b->agent_build_url) ? 'success' : 'queued';
        DB::table('cloud_builds')->where('id', $b->id)->update([
            'status' => $newStatus,
            'error_message' => null,
            'downloaded_bytes' => null,
            'finished_at' => null,
            'updated_at' => now(),
        ]);

        return $this->pullOne($buildId);
    }

    /**
     * 批量处理 pending：扫 stored_path IS NULL 且非终态行，对每条调 pullOne。
     * 返回成功 deliver 的条数（命令模式日志用）。
     */
    public function pullPending(int $batchSize = 5): int
    {
        if ($this->cutover?->workersPaused()) {
            return 0;
        }

        $pending = DB::table('cloud_builds')
            ->whereNull('stored_path')
            ->whereNotIn('status', ['failed', 'cancelled', 'expired', 'purged', 'delivered'])
            ->orderBy('created_at')
            ->limit($batchSize)
            ->get(['build_id']);

        if ($pending->isEmpty()) {
            return 0;
        }

        $delivered = 0;
        foreach ($pending as $row) {
            $r = $this->pullOne($row->build_id);
            if ($r['outcome'] === 'delivered' && $r['message'] === 'just_delivered') {
                $delivered++;
            }
        }
        return $delivered;
    }

    /**
     * 调 agent-build /api/build/download/{buildId} 探测就绪并拉取 URL 信息。
     * 返回 true 表示已写入本地 agent_build_url/sha256 等字段，可进入下载阶段；
     * 返回 false 表示本轮跳过（还在打包 / 已被 cancelled / 错误等）。
     */
    private function tryResolveDownload(object $build): bool
    {
        $resp = $this->sdk->getDownload($build->build_id);
        $httpStatus = (int) ($resp['_status'] ?? 0);
        $now = now();

        if ($httpStatus === 200 && !empty($resp['primary'])) {
            $primary = $resp['primary'];
            $supList = [];
            foreach (($resp['supplementary_files'] ?? []) as $sf) {
                if (!is_array($sf) || !isset($sf['url'], $sf['filename'])) continue;
                $supList[] = [
                    'filename' => (string) $sf['filename'],
                    'role' => (string) ($sf['role'] ?? 'unknown'),
                    'size' => (int) ($sf['size'] ?? 0),
                    'sha256' => (string) ($sf['sha256'] ?? ''),
                    'download_url' => (string) $sf['url'],
                    // 家庭电脑直连优选URL（可空）：下载时优先试，失败回退 download_url(CDN)
                    'preferred_url' => isset($sf['preferred_url']) ? (string) $sf['preferred_url'] : null,
                ];
            }

            DB::table('cloud_builds')->where('id', $build->id)->update([
                'status' => 'success',
                'agent_build_url' => (string) $primary['url'],
                // 家庭电脑直连优选URL（agent-build 开启 direct_mirror 且家庭电脑在线时才有）
                'agent_build_preferred_url' => isset($primary['preferred_url']) ? (string) $primary['preferred_url'] : null,
                'filename' => (string) $primary['filename'],
                'artifact_size' => (int) $primary['size'],
                'sha256' => (string) $primary['sha256'],
                'supplementary_files' => json_encode($supList, JSON_UNESCAPED_SLASHES),
                'finished_at' => $build->finished_at ?? $now,
                'updated_at' => $now,
            ]);

            return true;
        }

        if ($httpStatus === 425) {
            $remote = $resp['current_status'] ?? null;
            if ($remote === 'pending') $remote = 'queued';
            if ($remote && $remote !== $build->status && in_array($remote, ['queued', 'building', 'success', 'failed', 'cancelled', 'expired'], true)) {
                DB::table('cloud_builds')->where('id', $build->id)->update([
                    'status' => $remote,
                    'updated_at' => $now,
                ]);
            }
            return false;
        }

        if ($httpStatus === 410) {
            $nextStatus = (string) ($resp['status'] ?? '');
            if (!in_array($nextStatus, ['failed', 'cancelled', 'expired', 'purged'], true)) {
                $nextStatus = ($resp['error'] ?? '') === 'mirror_failed' ? 'failed' : 'expired';
            }
            DB::table('cloud_builds')->where('id', $build->id)->update([
                'status' => $nextStatus,
                'error_message' => 'agent_build_artifact_' . ($resp['error'] ?? 'expired_or_purged'),
                'finished_at' => $build->finished_at ?? $now,
                'updated_at' => $now,
            ]);
            return false;
        }

        if ($httpStatus === 404) {
            DB::table('cloud_builds')->where('id', $build->id)->update([
                'status' => 'failed',
                'error_message' => 'agent_build_not_found',
                'finished_at' => $now,
                'updated_at' => $now,
            ]);
            return false;
        }

        Log::warning('[CloudBuildPull] getDownload abnormal', [
            'build_id' => $build->build_id,
            'status' => $httpStatus,
            'error' => $resp['_error'] ?? $resp['error'] ?? null,
        ]);
        return false;
    }

    /**
     * 真正下载 + 落盘 + ack。
     */
    private function downloadAndPlace(object $b): bool
    {
        // 乐观锁原子抢占：避免 wake/cron/refresh 并发触发同一 buildId 重复进下载流水。
        // 只接管状态还在「可进入下载」集合的 build（success/queued/building），
        // 或上次跑带崩潰留下、超过下载超时阈值（30min curl + 5min 缓冲）的 downloading。
        // MySQL UPDATE在同行上是串行化的：同时运行两份 UPDATE，只有第一份的 affected=1，
        // 后者看到 status 已不在 WHERE 集合 → affected=0 → 静默退出。
        $claimed = DB::table('cloud_builds')
            ->where('id', $b->id)
            ->where(function ($q) {
                $q->whereIn('status', ['success', 'queued', 'building'])
                  ->orWhere(function ($q2) {
                      $q2->where('status', 'downloading')
                         ->where('updated_at', '<', now()->subMinutes(35));
                  });
            })
            ->update([
                'status' => 'downloading',
                'downloaded_bytes' => 0,
                'updated_at' => now(),
            ]);
        if ($claimed === 0) {
            // 别的 worker 已接管 / 已 deliver 完成。退出避免后面 download 失败时
            // 重写 status='failed' 把同伴写入的 stored_path/delivered 状态盖掉。
            Log::info('[CloudBuildPull] race: skipped, another worker owns this build', [
                'build_id' => $b->build_id,
                'current_status' => $b->status,
            ]);
            return false;
        }

        // 每个文件准备一个「候选 URL 列表」：直连优选(preferred)在前、CDN 在后。
        // 下载时按序尝试，任一验证通过即可 —— 直连优先提速，家里挂了自动回退 CDN。
        $allDownloads = [
            [
                'filename' => $b->filename,
                'urls' => array_values(array_filter([
                    $b->agent_build_preferred_url ?? null,
                    $b->agent_build_url,
                ], fn ($u) => is_string($u) && $u !== '')),
                'sha256' => $b->sha256,
                'role' => 'primary',
            ],
        ];
        $supRaw = $b->supplementary_files;
        $supList = is_string($supRaw) ? json_decode($supRaw, true) : (is_array($supRaw) ? $supRaw : []);
        if (is_array($supList)) {
            foreach ($supList as $sf) {
                if (!is_array($sf) || !isset($sf['filename'], $sf['download_url'], $sf['sha256'])) continue;
                $allDownloads[] = [
                    'filename' => $sf['filename'],
                    'urls' => array_values(array_filter([
                        $sf['preferred_url'] ?? null,
                        $sf['download_url'],
                    ], fn ($u) => is_string($u) && $u !== '')),
                    'sha256' => $sf['sha256'],
                    'role' => $sf['role'] ?? 'unknown',
                ];
            }
        }

        $downloaded = [];
        $downloadFailed = null;
        foreach ($allDownloads as $d) {
            // 仅 primary 大文件传 cloudBuildId 让 service 写进度；supplementary 太小没意义
            $progressBuildId = (($d['role'] ?? '') === 'primary') ? $b->id : null;
            $r = $this->downloadWithFallback($d['urls'], $d['sha256'], $progressBuildId);
            if (!$r['verified']) {
                $downloadFailed = $d['filename'] . ':' . ($r['error'] ?? 'verify_failed');
                break;
            }
            $downloaded[] = ['tmp_path' => $r['tmp_path'], 'filename' => $d['filename']];
        }

        if ($downloadFailed !== null) {
            foreach ($downloaded as $dn) @unlink($dn['tmp_path']);
            // 兑底：并发 race 下同伴 worker 可能在我们走到这里之前已 deliver 完成，
            // 重读状态避免把 stored_path/delivered_at 存在但 status 被错误覆写为 failed。
            $current = DB::table('cloud_builds')->where('id', $b->id)->first();
            if ($current && $current->status === 'delivered') {
                Log::info('[CloudBuildPull] sibling already delivered, skip failure write', [
                    'build_id' => $b->build_id,
                    'our_error' => 'download:' . $downloadFailed,
                ]);
                return true;
            }
            DB::table('cloud_builds')->where('id', $b->id)->update([
                'status' => 'failed',
                'error_message' => 'download:' . $downloadFailed,
                'updated_at' => now(),
            ]);
            return false;
        }

        $placed = $this->dir->atomicReplaceMany($downloaded, $b->platform);
        if (!$placed['ok']) {
            foreach ($downloaded as $dn) @unlink($dn['tmp_path']);
            $err = $placed['error'] ?? 'place_failed';
            // 兑底：同 download 失败分支，避免覆写同伴 worker 已完成的 delivered 状态。
            $current = DB::table('cloud_builds')->where('id', $b->id)->first();
            if ($current && $current->status === 'delivered') {
                Log::info('[CloudBuildPull] sibling already delivered, skip failure write', [
                    'build_id' => $b->build_id,
                    'our_error' => 'place:' . $err,
                ]);
                return true;
            }
            DB::table('cloud_builds')->where('id', $b->id)->update([
                'status' => 'failed',
                'error_message' => 'place:' . $err,
                'updated_at' => now(),
            ]);
            return false;
        }

        // 建 filename -> stored_path 映射，primary 写主字段，supplementary_files 里每项补一条 stored_path
        $placedByName = [];
        foreach ($placed['placed'] as $p) {
            $placedByName[$p['filename']] = $p['stored_path'];
        }
        $primaryStored = $placedByName[$b->filename] ?? ($placed['placed'][0]['stored_path'] ?? null);

        // 副件原本只存了 filename / role / size / sha256 / download_url；
        // mac 同时会出现两个 role='primary' 的 zip（x64 + arm64），arm64 那一个走 supplementary 通道，
        // 前端展示「本地路径」时需要它的真实落盘路径才能给出下载链接，所以这里把 stored_path 回写进去。
        $updatedSupList = [];
        if (is_array($supList)) {
            foreach ($supList as $sf) {
                if (!is_array($sf)) continue;
                $name = (string) ($sf['filename'] ?? '');
                if ($name !== '' && isset($placedByName[$name])) {
                    $sf['stored_path'] = $placedByName[$name];
                }
                $updatedSupList[] = $sf;
            }
        }

        DB::table('cloud_builds')->where('id', $b->id)->update([
            'status' => 'delivered',
            'stored_path' => $primaryStored,
            'supplementary_files' => json_encode($updatedSupList, JSON_UNESCAPED_SLASHES),
            'downloaded_at' => now(),
            'delivered_at' => now(),
            'updated_at' => now(),
        ]);

        $ackResp = $this->sdk->ack($b->build_id, $primaryStored, true);
        if (($ackResp['_status'] ?? 0) !== 200) {
            Log::warning('[CloudBuildPull] ack failed', [
                'build_id' => $b->build_id,
                'status' => $ackResp['_status'] ?? 0,
            ]);
        }

        return true;
    }

    /**
     * 按序尝试一组候选 URL（直连优选在前、CDN 在后），任一 sha256 验证通过即返回其结果。
     * 非最后一个候选（如家庭电脑直连）走「快速失败」模式：短连接超时 + 低速中断，
     * 连不上/慢时立刻回退下一个，绝不拖到 30 分钟主超时。全部失败返回最后一次结果。
     *
     * @param string[] $urls
     * @return array{tmp_path:string,size:int,sha256:string,verified:bool,error?:string}
     */
    private function downloadWithFallback(array $urls, string $sha256, ?int $progressBuildId): array
    {
        if (empty($urls)) {
            return ['tmp_path' => '', 'size' => 0, 'sha256' => '', 'verified' => false, 'error' => 'no_url'];
        }
        $fastFailTimeout = (int) config('cloudbuild.download.direct_connect_timeout', 8);
        $count = count($urls);
        $last = ['tmp_path' => '', 'size' => 0, 'sha256' => '', 'verified' => false, 'error' => 'no_url'];

        foreach ($urls as $i => $url) {
            $isLast = ($i === $count - 1);
            $r = $this->download->downloadAndVerify(
                $url,
                $sha256,
                $progressBuildId,
                'cloud_builds',
                $isLast ? null : $fastFailTimeout
            );
            if ($r['verified']) {
                if ($i > 0) {
                    Log::info('[CloudBuildPull] fell back to next candidate url', [
                        'used_index' => $i,
                        'url' => $url,
                    ]);
                }
                return $r;
            }
            $last = $r;
            if (!$isLast) {
                Log::info('[CloudBuildPull] candidate url failed, trying next', [
                    'index' => $i,
                    'url' => $url,
                    'error' => $r['error'] ?? 'unknown',
                ]);
            }
        }
        return $last;
    }
}
