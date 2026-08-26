<?php

namespace App\Services\CloudBuild;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class OemBuildPullService
{
    public function __construct(
        private AgentBuildClient $sdk,
        private ArtifactDownloadService $download,
        private UpdateDirService $dir,
        private CloudBuildBackendSelector $selector,
        private CloudBuildLocalDeliveryService $local,
        private ?CloudBuildCutoverStore $cutover = null,
    ) {}

    public function pullOne(string $buildId): array
    {
        if ($this->cutover?->workersPaused()) {
            return ['outcome' => 'skipped', 'message' => 'workers_paused', 'row' => null];
        }

        if ($this->selector->usesLocal()) {
            return $this->local->deliver('oem_builds', $buildId);
        }

        $b = DB::table('oem_builds')->where('build_id', $buildId)->first();
        if (!$b) {
            return ['outcome' => 'not_found', 'message' => 'oem_build_not_found', 'row' => null];
        }

        if (in_array($b->status, ['delivered'], true)) {
            return ['outcome' => 'delivered', 'message' => 'already_delivered', 'row' => $b];
        }
        if (in_array($b->status, ['failed', 'cancelled', 'expired', 'purged'], true)) {
            return ['outcome' => $b->status, 'message' => (string) ($b->error_message ?? ''), 'row' => $b];
        }

        if (empty($b->agent_build_url) || empty($b->sha256)) {
            $resolved = $this->tryResolveDownload($b);
            if (!$resolved) {
                $b = DB::table('oem_builds')->where('id', $b->id)->first();
                return ['outcome' => 'in_progress', 'message' => 'awaiting_artifact', 'row' => $b];
            }
            $b = DB::table('oem_builds')->where('id', $b->id)->first();
        }

        $ok = $this->downloadAndPlace($b);
        $b = DB::table('oem_builds')->where('id', $b->id)->first();
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
            return $this->local->requeue('oem_builds', $buildId);
        }

        $b = DB::table('oem_builds')->where('build_id', $buildId)->first();
        if (!$b) {
            return ['outcome' => 'not_found', 'message' => 'oem_build_not_found', 'row' => null];
        }
        if (!in_array((string) $b->status, ['failed', 'expired', 'cancelled'], true)) {
            return ['outcome' => 'failed', 'message' => 'not_retryable', 'row' => $b];
        }

        $newStatus = !empty($b->agent_build_url) ? 'success' : 'queued';
        DB::table('oem_builds')->where('id', $b->id)->update([
            'status' => $newStatus,
            'error_message' => null,
            'downloaded_bytes' => null,
            'finished_at' => null,
            'updated_at' => now(),
        ]);

        return $this->pullOne($buildId);
    }

    public function pullPending(int $batchSize = 5): int
    {
        if ($this->cutover?->workersPaused()) {
            return 0;
        }

        $pending = DB::table('oem_builds')
            ->whereNull('stored_path')
            ->whereNotIn('status', ['failed', 'cancelled', 'expired', 'purged', 'delivered'])
            ->orderBy('created_at')
            ->limit($batchSize)
            ->get(['build_id']);

        $delivered = 0;
        foreach ($pending as $row) {
            $r = $this->pullOne($row->build_id);
            if ($r['outcome'] === 'delivered' && $r['message'] === 'just_delivered') {
                $delivered++;
            }
        }
        return $delivered;
    }

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
                ];
            }

            DB::table('oem_builds')->where('id', $build->id)->update([
                'status' => 'success',
                'agent_build_url' => (string) $primary['url'],
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
                DB::table('oem_builds')->where('id', $build->id)->update([
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
            DB::table('oem_builds')->where('id', $build->id)->update([
                'status' => $nextStatus,
                'error_message' => 'agent_build_artifact_' . ($resp['error'] ?? 'expired_or_purged'),
                'finished_at' => $build->finished_at ?? $now,
                'updated_at' => $now,
            ]);
            return false;
        }

        if ($httpStatus === 404) {
            DB::table('oem_builds')->where('id', $build->id)->update([
                'status' => 'failed',
                'error_message' => 'agent_build_not_found',
                'finished_at' => $now,
                'updated_at' => $now,
            ]);
            return false;
        }

        Log::warning('[OemBuildPull] getDownload abnormal', [
            'build_id' => $build->build_id,
            'status' => $httpStatus,
            'error' => $resp['_error'] ?? $resp['error'] ?? null,
        ]);
        return false;
    }

    private function downloadAndPlace(object $b): bool
    {
        $claimed = DB::table('oem_builds')
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
            return false;
        }

        $allDownloads = [[
            'filename' => $b->filename,
            'url' => $b->agent_build_url,
            'sha256' => $b->sha256,
            'role' => 'primary',
        ]];
        $supRaw = $b->supplementary_files;
        $supList = is_string($supRaw) ? json_decode($supRaw, true) : (is_array($supRaw) ? $supRaw : []);
        if (is_array($supList)) {
            foreach ($supList as $sf) {
                if (!is_array($sf) || !isset($sf['filename'], $sf['download_url'], $sf['sha256'])) continue;
                $allDownloads[] = [
                    'filename' => $sf['filename'],
                    'url' => $sf['download_url'],
                    'sha256' => $sf['sha256'],
                    'role' => $sf['role'] ?? 'unknown',
                ];
            }
        }

        $downloaded = [];
        $downloadFailed = null;
        foreach ($allDownloads as $d) {
            $progressBuildId = (($d['role'] ?? '') === 'primary') ? $b->id : null;
            $r = $this->download->downloadAndVerify($d['url'], $d['sha256'], $progressBuildId, 'oem_builds');
            if (!$r['verified']) {
                $downloadFailed = $d['filename'] . ':' . ($r['error'] ?? 'verify_failed');
                break;
            }
            $downloaded[] = ['tmp_path' => $r['tmp_path'], 'filename' => $d['filename']];
        }

        if ($downloadFailed !== null) {
            foreach ($downloaded as $dn) @unlink($dn['tmp_path']);
            $current = DB::table('oem_builds')->where('id', $b->id)->first();
            if ($current && $current->status === 'delivered') {
                Log::info('[OemBuildPull] sibling already delivered, skip failure write', [
                    'build_id' => $b->build_id,
                    'our_error' => 'download:' . $downloadFailed,
                ]);
                return true;
            }
            DB::table('oem_builds')->where('id', $b->id)->update([
                'status' => 'failed',
                'error_message' => 'download:' . $downloadFailed,
                'updated_at' => now(),
            ]);
            return false;
        }

        $targetSubdir = 'oem/' . $b->project_key;
        $placed = $this->dir->atomicReplaceMany($downloaded, $b->platform, $targetSubdir);
        if (!$placed['ok']) {
            foreach ($downloaded as $dn) @unlink($dn['tmp_path']);
            $err = $placed['error'] ?? 'place_failed';
            $current = DB::table('oem_builds')->where('id', $b->id)->first();
            if ($current && $current->status === 'delivered') {
                Log::info('[OemBuildPull] sibling already delivered, skip failure write', [
                    'build_id' => $b->build_id,
                    'our_error' => 'place:' . $err,
                ]);
                return true;
            }
            DB::table('oem_builds')->where('id', $b->id)->update([
                'status' => 'failed',
                'error_message' => 'place:' . $err,
                'updated_at' => now(),
            ]);
            return false;
        }

        $placedByName = [];
        foreach ($placed['placed'] as $p) {
            $placedByName[$p['filename']] = $p['stored_path'];
        }
        $primaryStored = $placedByName[$b->filename] ?? ($placed['placed'][0]['stored_path'] ?? null);
        if (!$primaryStored) {
            DB::table('oem_builds')->where('id', $b->id)->update([
                'status' => 'failed',
                'error_message' => 'place:missing_primary_stored_path',
                'updated_at' => now(),
            ]);
            return false;
        }

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

        $now = now();
        DB::table('oem_builds')->where('id', $b->id)->update([
            'status' => 'delivered',
            'stored_path' => $primaryStored,
            'supplementary_files' => json_encode($updatedSupList, JSON_UNESCAPED_SLASHES),
            'downloaded_at' => $now,
            'delivered_at' => $now,
            'updated_at' => $now,
        ]);
        DB::table('oem_projects')->where('id', $b->oem_project_id)->update([
            'current_version' => $b->app_version,
            'last_build_at' => $now,
            'updated_at' => $now,
        ]);

        $ackResp = $this->sdk->ack($b->build_id, $primaryStored, true);
        if (($ackResp['_status'] ?? 0) !== 200) {
            Log::warning('[OemBuildPull] ack failed', [
                'build_id' => $b->build_id,
                'status' => $ackResp['_status'] ?? 0,
            ]);
        }

        return true;
    }
}
