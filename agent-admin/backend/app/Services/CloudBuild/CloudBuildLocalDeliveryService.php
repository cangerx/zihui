<?php

namespace App\Services\CloudBuild;

use App\Models\CloudBuildArtifact;
use App\Models\CloudBuildAttempt;
use App\Models\CloudBuildJob;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * 本地 backend 的 refresh/pull：就绪产物从 storage_path 拷到 updates，不打授权端。
 */
class CloudBuildLocalDeliveryService
{
    public function __construct(
        private CloudBuildEnqueueService $enqueue,
        private CloudBuildLocalSiteIdentity $site,
        private CloudBuildProjectionSynchronizer $sync,
        private CloudBuildFrontendStatusProjector $projector,
        private CloudBuildPurgeService $purge,
        private UpdateDirService $dir,
        private CloudBuildArtifactFetchService $fetch,
        private CloudBuildGitHubGateway $github,
        private ?CloudBuildLocalDispatchService $dispatch = null,
    ) {
    }

    /**
     * @return array{outcome:string,message:string,row:?object}
     */
    public function deliver(string $table, string $buildId): array
    {
        if (!in_array($table, ['cloud_builds', 'oem_builds'], true)) {
            return ['outcome' => 'failed', 'message' => 'invalid_table', 'row' => null];
        }

        $row = DB::table($table)->where('build_id', $buildId)->first();
        if ($row === null) {
            return ['outcome' => 'not_found', 'message' => $table === 'oem_builds' ? 'oem_build_not_found' : 'cloud_build_not_found', 'row' => null];
        }

        if ((string) $row->status === 'delivered') {
            return ['outcome' => 'delivered', 'message' => 'already_delivered', 'row' => $row];
        }

        $job = CloudBuildJob::query()->where('build_id', $buildId)->first();
        if ($job && in_array((string) $job->phase, CloudBuildStateMachine::TERMINAL, true)) {
            $row = $this->sync->syncTable($table, $buildId) ?: $row;
            return [
                'outcome' => $this->projector->fromPhase((string) $job->phase),
                'message' => (string) ($job->error_message ?? ''),
                'row' => $row,
            ];
        }

        if (in_array((string) $row->status, ['failed', 'cancelled', 'expired', 'purged'], true)) {
            return ['outcome' => (string) $row->status, 'message' => (string) ($row->error_message ?? ''), 'row' => $row];
        }

        $job = $this->resolveJob($table, $row);
        $row = $this->sync->syncTable($table, $buildId) ?: $row;
        if ($job === null) {
            return ['outcome' => 'in_progress', 'message' => 'awaiting_artifact', 'row' => $row];
        }

        $phase = (string) $job->phase;
        if ($phase === CloudBuildPhaseNormalizer::PHASE_DELIVERED) {
            return ['outcome' => 'delivered', 'message' => 'already_delivered', 'row' => $row];
        }
        if (in_array($phase, CloudBuildStateMachine::TERMINAL, true)) {
            $row = $this->sync->syncTable($table, $buildId) ?: $row;
            return ['outcome' => $this->projector->fromPhase($phase), 'message' => (string) ($job->error_message ?? ''), 'row' => $row];
        }

        if ($phase === CloudBuildPhaseNormalizer::PHASE_ARTIFACT_PENDING) {
            if ($this->github->isConfigured()) {
                try {
                    $this->fetch->fetchOne($buildId, 'pull:' . getmypid());
                } catch (\Throwable $e) {
                    try {
                        Log::warning('[CloudBuildLocalDelivery] fetch skipped', [
                            'build_id' => $buildId,
                            'error' => $e->getMessage(),
                        ]);
                    } catch (\Throwable $ignored) {
                    }
                }
                $job = CloudBuildJob::query()->where('build_id', $buildId)->first() ?: $job;
                $phase = (string) $job->phase;
                $row = $this->sync->syncTable($table, $buildId) ?: $row;
            }
            if ($phase !== CloudBuildPhaseNormalizer::PHASE_READY) {
                return ['outcome' => 'in_progress', 'message' => 'awaiting_artifact', 'row' => $row];
            }
        }

        if (in_array($phase, [
            CloudBuildPhaseNormalizer::PHASE_QUEUED,
            CloudBuildPhaseNormalizer::PHASE_BUILDING,
        ], true)) {
            return ['outcome' => 'in_progress', 'message' => 'awaiting_artifact', 'row' => $row];
        }

        if (!in_array($phase, [
            CloudBuildPhaseNormalizer::PHASE_READY,
            CloudBuildPhaseNormalizer::PHASE_LEGACY,
        ], true)) {
            return ['outcome' => 'in_progress', 'message' => 'awaiting_artifact', 'row' => $row];
        }

        $ok = $this->placeFromLocalStore($table, $row, $job);
        $row = DB::table($table)->where('id', $row->id)->first();
        if ($ok) {
            return ['outcome' => 'delivered', 'message' => 'just_delivered', 'row' => $row];
        }
        if ($row && (string) $row->status === 'downloading') {
            return ['outcome' => 'in_progress', 'message' => 'download_in_progress', 'row' => $row];
        }
        if ($row && in_array((string) $row->status, ['queued', 'building', 'success'], true)) {
            return ['outcome' => 'in_progress', 'message' => 'awaiting_artifact', 'row' => $row];
        }
        if ($row && in_array((string) $row->status, ['delivered', 'failed', 'cancelled', 'expired', 'purged'], true)) {
            return ['outcome' => (string) $row->status, 'message' => (string) ($row->error_message ?? ''), 'row' => $row];
        }

        return [
            'outcome' => 'failed',
            'message' => (string) ($row->error_message ?? 'unknown'),
            'row' => $row,
        ];
    }

    /**
     * 管理员重试入口。无产物 URL 时才重建终态 job；refresh/deliver 不得调用。
     *
     * @return array{outcome:string,message:string,row:?object}
     */
    public function requeue(string $table, string $buildId): array
    {
        if (!in_array($table, ['cloud_builds', 'oem_builds'], true)) {
            return ['outcome' => 'failed', 'message' => 'invalid_table', 'row' => null];
        }

        $row = DB::table($table)->where('build_id', $buildId)->first();
        if ($row === null) {
            return ['outcome' => 'not_found', 'message' => $table === 'oem_builds' ? 'oem_build_not_found' : 'cloud_build_not_found', 'row' => null];
        }

        if (!in_array((string) $row->status, ['failed', 'expired', 'cancelled'], true)) {
            return ['outcome' => 'failed', 'message' => 'not_retryable', 'row' => $row];
        }

        $existing = CloudBuildJob::query()->where('build_id', $buildId)->first();
        if ($this->canRefetchRelease($existing)) {
            return $this->refetchRelease($table, $row, $existing);
        }

        if (!empty($row->agent_build_url) && !str_starts_with((string) $row->agent_build_url, 'local://')) {
            DB::table($table)->where('id', $row->id)->update([
                'status' => 'success',
                'error_message' => null,
                'downloaded_bytes' => null,
                'finished_at' => null,
                'updated_at' => Carbon::now(),
            ]);
            return $this->deliver($table, $buildId);
        }

        $deny = PackagingLicense::denyReason((string) ($row->platform ?? 'win'));
        if ($deny !== null) {
            return ['outcome' => 'failed', 'message' => $deny, 'row' => $row];
        }

        $old = CloudBuildJob::query()->where('build_id', $buildId)->first();
        $job = $this->resurrect($table, $row, $old);
        DB::table($table)->where('id', $row->id)->update([
            'status' => 'queued',
            'error_message' => null,
            'downloaded_bytes' => null,
            'finished_at' => null,
            'updated_at' => Carbon::now(),
        ]);

        if ($job && $this->github->isConfigured() && $this->dispatch) {
            try {
                $this->dispatch->dispatchPending();
            } catch (\Throwable $e) {
                try {
                    Log::warning('[CloudBuildLocalDelivery] requeue dispatch skipped', [
                        'build_id' => $buildId,
                        'error' => $e->getMessage(),
                    ]);
                } catch (\Throwable $ignored) {
                }
            }
        }

        return $this->deliver($table, $buildId);
    }

    private function canRefetchRelease(?CloudBuildJob $job): bool
    {
        if ($job === null) {
            return false;
        }
        if ((string) $job->phase !== CloudBuildPhaseNormalizer::PHASE_FAILED) {
            return false;
        }
        return !empty($job->release_assets);
    }

    /**
     * 已有 GitHub Release 时只重拉，不新建 job、不重新 dispatch。
     * 终态状态机不允许 failed→artifact_pending，管理侧重试在这里直接回写。
     *
     * @return array{outcome:string,message:string,row:?object}
     */
    private function refetchRelease(string $table, object $row, CloudBuildJob $job): array
    {
        CloudBuildArtifact::query()->where('build_id', $job->build_id)->update([
            'fetch_attempts' => 0,
            'storage_path' => null,
        ]);
        $job->phase = CloudBuildPhaseNormalizer::PHASE_ARTIFACT_PENDING;
        $job->error_message = null;
        $job->claim_owner = null;
        $job->claimed_at = null;
        $job->finished_at = null;
        $job->save();

        DB::table($table)->where('id', $row->id)->update([
            'status' => 'success',
            'error_message' => null,
            'downloaded_bytes' => null,
            'finished_at' => null,
            'updated_at' => Carbon::now(),
        ]);

        return $this->deliver($table, (string) $row->build_id);
    }

    private function resolveJob(string $table, object $row): ?CloudBuildJob
    {
        $job = CloudBuildJob::query()->where('build_id', $row->build_id)->first();
        if ($job !== null) {
            return $job;
        }

        $retryableProjection = in_array((string) $row->status, ['queued', 'success', 'downloading'], true);
        if (!$retryableProjection) {
            return null;
        }

        return $this->resurrect($table, $row, null);
    }

    private function resurrect(string $table, object $row, ?CloudBuildJob $old): ?CloudBuildJob
    {
        $buildId = (string) $row->build_id;
        CloudBuildArtifact::query()->where('build_id', $buildId)->delete();
        CloudBuildAttempt::query()->where('build_id', $buildId)->delete();
        if ($old) {
            $old->delete();
        }

        $this->site->ensureClient();
        $input = [
            'client_ref' => CloudBuildLocalSiteIdentity::CLIENT_REF,
            'platform' => (string) $row->platform,
            'app_name' => (string) $row->app_name,
            'app_version' => (string) ($row->app_version ?? ''),
            'icon_path' => (string) ($row->icon_path ?? $row->icon_url ?? ''),
            'build_id' => $buildId,
        ];
        if ($table === 'oem_builds') {
            $input['build_mode'] = 'oem';
            $input['oem_project_key'] = (string) $row->project_key;
            $input['app_id'] = $row->app_id ?? null;
            $input['update_path'] = $row->update_path ?? null;
        }

        $result = $this->enqueue->enqueue($input);
        return $result->ok ? $result->job : null;
    }

    private function placeFromLocalStore(string $table, object $row, CloudBuildJob $job): bool
    {
        $claimed = DB::table($table)
            ->where('id', $row->id)
            ->where(function ($q) {
                $q->whereIn('status', ['success', 'queued', 'building'])
                    ->orWhere(function ($q2) {
                        $q2->where('status', 'downloading')
                            ->where('updated_at', '<', Carbon::now()->subMinutes(35));
                    });
            })
            ->update([
                'status' => 'downloading',
                'downloaded_bytes' => 0,
                'updated_at' => Carbon::now(),
            ]);
        if ($claimed === 0) {
            return false;
        }

        $artifacts = CloudBuildArtifact::query()->where('build_id', $job->build_id)->get();
        $files = [];
        $tmpCopies = [];
        foreach ($artifacts as $artifact) {
            $src = (string) ($artifact->storage_path ?? '');
            if ($src === '' || !is_file($src)) {
                foreach ($tmpCopies as $tmp) {
                    @unlink($tmp);
                }
                DB::table($table)->where('id', $row->id)->update([
                    'status' => 'success',
                    'error_message' => null,
                    'updated_at' => Carbon::now(),
                ]);
                return false;
            }
            $tmp = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'cb-place-' . bin2hex(random_bytes(8)) . '-' . basename((string) $artifact->filename);
            if (!@copy($src, $tmp)) {
                foreach ($tmpCopies as $copied) {
                    @unlink($copied);
                }
                DB::table($table)->where('id', $row->id)->update([
                    'status' => 'failed',
                    'error_message' => 'place:copy_failed:' . $artifact->filename,
                    'updated_at' => Carbon::now(),
                ]);
                return false;
            }
            $tmpCopies[] = $tmp;
            $files[] = ['tmp_path' => $tmp, 'filename' => (string) $artifact->filename];
        }

        if ($files === []) {
            DB::table($table)->where('id', $row->id)->update([
                'status' => 'success',
                'updated_at' => Carbon::now(),
            ]);
            return false;
        }

        $targetSubdir = '';
        if ($table === 'oem_builds') {
            $targetSubdir = 'oem/' . (string) $row->project_key;
        }
        $placed = $this->dir->atomicReplaceMany($files, (string) $row->platform, $targetSubdir);
        if (!$placed['ok']) {
            foreach ($tmpCopies as $tmp) {
                @unlink($tmp);
            }
            DB::table($table)->where('id', $row->id)->update([
                'status' => 'failed',
                'error_message' => 'place:' . ($placed['error'] ?? 'place_failed'),
                'updated_at' => Carbon::now(),
            ]);
            return false;
        }

        $placedByName = [];
        foreach ($placed['placed'] as $p) {
            $placedByName[$p['filename']] = $p['stored_path'];
        }
        $primaryName = (string) ($row->filename ?? '');
        $primaryStored = $placedByName[$primaryName] ?? ($placed['placed'][0]['stored_path'] ?? null);

        $supRaw = $row->supplementary_files ?? null;
        $supList = is_string($supRaw) ? json_decode($supRaw, true) : (is_array($supRaw) ? $supRaw : []);
        $updatedSup = [];
        if (is_array($supList)) {
            foreach ($supList as $sf) {
                if (!is_array($sf)) {
                    continue;
                }
                $name = (string) ($sf['filename'] ?? '');
                if ($name !== '' && isset($placedByName[$name])) {
                    $sf['stored_path'] = $placedByName[$name];
                }
                $updatedSup[] = $sf;
            }
        }

        $now = Carbon::now();
        DB::table($table)->where('id', $row->id)->update([
            'status' => 'delivered',
            'stored_path' => $primaryStored,
            'supplementary_files' => json_encode($updatedSup, JSON_UNESCAPED_SLASHES),
            'downloaded_at' => $now,
            'delivered_at' => $now,
            'error_message' => null,
            'updated_at' => $now,
        ]);

        try {
            $fresh = CloudBuildJob::query()->where('build_id', $job->build_id)->first();
            if ($fresh && (string) $fresh->phase === CloudBuildPhaseNormalizer::PHASE_READY) {
                $this->purge->markDelivered($fresh);
            }
        } catch (\Throwable $e) {
            try {
                Log::warning('[CloudBuildLocalDelivery] mark delivered failed', [
                    'build_id' => $job->build_id,
                    'error' => $e->getMessage(),
                ]);
            } catch (\Throwable $ignored) {
            }
        }

        return true;
    }
}
