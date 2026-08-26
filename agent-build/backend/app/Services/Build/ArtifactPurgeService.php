<?php

namespace App\Services\Build;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ArtifactPurgeService
{
    private GitHubDispatchService $github;

    public function __construct(GitHubDispatchService $github)
    {
        $this->github = $github;
    }

    /**
     * 双删：unlink 本地 + GitHub DELETE artifacts + UPDATE status=purged
     */
    public function purgeForBuild(string $buildId): bool
    {
        $build = DB::table('build_requests')->where('build_id', $buildId)->first();
        if (!$build) {
            return false;
        }

        $storageBase = storage_path(config('build.storage.subdir'));
        $buildDir = $storageBase . DIRECTORY_SEPARATOR . $buildId;
        if (is_dir($buildDir)) {
            foreach (scandir($buildDir) ?: [] as $f) {
                if ($f === '.' || $f === '..') continue;
                @unlink($buildDir . DIRECTORY_SEPARATOR . $f);
            }
            @rmdir($buildDir);
        }

        // GitHub 侧：通过 run_id 反查 artifact_id 删除
        if ($this->github->isConfigured() && $build->executor_run_id) {
            $artifacts = $this->github->listArtifacts((int) $build->executor_run_id);
            foreach ($artifacts as $a) {
                $ok = $this->github->deleteArtifact((int) $a['id']);
                if (!$ok) {
                    Log::warning('[Purge] GitHub deleteArtifact failed', [
                        'build_id' => $buildId,
                        'artifact_id' => $a['id'],
                    ]);
                }
            }
        }

        DB::table('build_requests')->where('build_id', $buildId)->update([
            'status' => 'purged',
            'purged_at' => now(),
            'updated_at' => now(),
        ]);

        return true;
    }
}
