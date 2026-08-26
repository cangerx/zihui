<?php

namespace App\Services\CloudBuild;

use App\Models\CloudBuildArtifact;
use App\Models\CloudBuildJob;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * 把规范阶段同步回 cloud_builds / oem_builds 投影，供现有前端轮询。
 */
class CloudBuildProjectionSynchronizer
{
    public function __construct(private CloudBuildFrontendStatusProjector $projector)
    {
    }

    public function syncByBuildId(string $buildId): void
    {
        $this->syncTable('cloud_builds', $buildId);
        $this->syncTable('oem_builds', $buildId);
    }

    public function syncTable(string $table, string $buildId): ?object
    {
        if (!in_array($table, ['cloud_builds', 'oem_builds'], true)) {
            return null;
        }

        try {
            $row = DB::table($table)->where('build_id', $buildId)->first();
        } catch (\Throwable $e) {
            return null;
        }
        if ($row === null) {
            return null;
        }

        $job = CloudBuildJob::query()->where('build_id', $buildId)->first();
        if ($job === null) {
            return $row;
        }

        $localStatus = (string) ($row->status ?? '');
        $status = $this->projector->fromPhase((string) $job->phase, $localStatus === 'downloading' ? 'downloading' : null);
        $update = [
            'status' => $status,
            'updated_at' => Carbon::now(),
        ];
        if ($job->started_at) {
            $update['started_at'] = $job->started_at;
        }
        if (in_array($status, ['failed', 'cancelled', 'expired', 'purged'], true)) {
            $update['error_message'] = $job->error_message;
            $update['finished_at'] = $job->finished_at ?: Carbon::now();
        }
        if (in_array((string) $job->phase, [
            CloudBuildPhaseNormalizer::PHASE_ARTIFACT_PENDING,
            CloudBuildPhaseNormalizer::PHASE_READY,
            CloudBuildPhaseNormalizer::PHASE_DELIVERED,
            CloudBuildPhaseNormalizer::PHASE_LEGACY,
        ], true)) {
            $this->fillArtifactMeta($update, $job, $row);
        }

        DB::table($table)->where('id', $row->id)->update($update);

        return DB::table($table)->where('id', $row->id)->first();
    }

    /**
     * @param array<string, mixed> $update
     */
    private function fillArtifactMeta(array &$update, CloudBuildJob $job, object $row): void
    {
        $artifacts = CloudBuildArtifact::query()->where('build_id', $job->build_id)->get();
        if ($artifacts->isEmpty()) {
            return;
        }

        $primary = $artifacts->first(fn ($a) => (string) $a->role === 'primary') ?: $artifacts->first();
        if ($primary) {
            $update['filename'] = $primary->filename;
            $update['artifact_size'] = $primary->size;
            $update['sha256'] = $primary->sha256;
            if (empty($row->agent_build_url)) {
                $update['agent_build_url'] = 'local://' . $job->build_id;
            }
            if (empty($row->finished_at) && $job->finished_at) {
                $update['finished_at'] = $job->finished_at;
            }
        }

        $sup = [];
        foreach ($artifacts as $artifact) {
            if ($primary && $artifact->id === $primary->id) {
                continue;
            }
            $sup[] = [
                'filename' => $artifact->filename,
                'role' => $artifact->role,
                'size' => $artifact->size,
                'sha256' => $artifact->sha256,
                'download_url' => 'local://' . $job->build_id . '/' . $artifact->filename,
            ];
        }
        if ($sup !== []) {
            $update['supplementary_files'] = json_encode($sup, JSON_UNESCAPED_SLASHES);
        }
    }
}
