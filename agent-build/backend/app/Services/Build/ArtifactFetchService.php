<?php

namespace App\Services\Build;

use Illuminate\Support\Facades\Log;
use ZipArchive;

class ArtifactFetchService
{
    private GitHubDispatchService $github;

    public function __construct(GitHubDispatchService $github)
    {
        $this->github = $github;
    }

    /**
     * Fetch + unzip + classify all artifact files for an electron-updater install:
     *   - primary: .exe / .dmg
     *   - metadata: latest*.yml (electron-updater feed file)
     *   - blockmap: *.blockmap (incremental update support)
     *
     * @return array{
     *   artifact_id:int,
     *   artifact_name:string,
     *   primary: array{filename:string,path:string,relative_path:string,size:int,sha256:string,role:string},
     *   supplementary: list<array{filename:string,path:string,relative_path:string,size:int,sha256:string,role:string}>
     * }|null
     */
    public function fetchForBuild(int $runId, string $buildId, string $platform): ?array
    {
        if (!$this->github->isConfigured()) {
            Log::warning('[ArtifactFetch] GitHub not configured, skip', compact('buildId'));
            return null;
        }

        $artifacts = $this->github->listArtifacts($runId);
        if (empty($artifacts)) {
            Log::warning('[ArtifactFetch] no artifacts found', compact('runId', 'buildId'));
            return null;
        }

        $first = $artifacts[0];
        $artifactId = (int) $first['id'];
        $artifactName = (string) $first['name'];

        $storageBase = storage_path(config('build.storage.subdir'));
        $buildDir = $storageBase . DIRECTORY_SEPARATOR . $buildId;
        if (!is_dir($buildDir) && !mkdir($buildDir, 0755, true) && !is_dir($buildDir)) {
            Log::error('[ArtifactFetch] mkdir failed', compact('buildDir'));
            return null;
        }

        $zipPath = $buildDir . DIRECTORY_SEPARATOR . 'artifact.zip';
        // 0.3.2: 改用 sink 流式下载（不再一次性把 zip 加载到 PHP 内存）
        if (!$this->github->downloadArtifact($artifactId, $zipPath)) {
            Log::error('[ArtifactFetch] download failed', compact('artifactId'));
            return null;
        }

        $zip = new ZipArchive();
        if ($zip->open($zipPath) !== true) {
            Log::error('[ArtifactFetch] zip open failed', compact('zipPath'));
            @unlink($zipPath);
            return null;
        }
        $zip->extractTo($buildDir);
        $zip->close();
        @unlink($zipPath);

        $primaryExt = $platform === 'mac' ? '.dmg' : '.exe';
        $primary = null;
        $supplementary = [];

        foreach (scandir($buildDir) ?: [] as $f) {
            if ($f === '.' || $f === '..') continue;
            $full = $buildDir . DIRECTORY_SEPARATOR . $f;
            if (!is_file($full)) continue;

            $lower = strtolower($f);
            $role = $this->classify($lower, $primaryExt);
            if ($role === null) {
                continue; // ignore unrelated files (e.g. builder-effective-config.yml)
            }

            $size = filesize($full) ?: 0;
            $sha256 = hash_file('sha256', $full) ?: '';
            $info = [
                'filename' => $f,
                'path' => $full,
                'relative_path' => $buildId . '/' . $f,
                'size' => $size,
                'sha256' => $sha256,
                'role' => $role,
            ];

            if ($role === 'primary' && $primary === null) {
                $primary = $info;
            } else {
                $supplementary[] = $info;
            }
        }

        if ($primary === null) {
            Log::error('[ArtifactFetch] primary artifact not found', compact('buildDir', 'primaryExt'));
            return null;
        }

        // 本地已落盘，删除 GitHub 上的 artifact 释放存储（best-effort，失败不阻塞）
        try {
            $this->github->deleteArtifact($artifactId);
            Log::info('[ArtifactFetch] GitHub artifact deleted', compact('artifactId', 'buildId'));
        } catch (\Throwable $e) {
            Log::warning('[ArtifactFetch] GitHub artifact delete failed (non-blocking)', [
                'artifact_id' => $artifactId,
                'error' => $e->getMessage(),
            ]);
        }

        return [
            'artifact_id' => $artifactId,
            'artifact_name' => $artifactName,
            'primary' => $primary,
            'supplementary' => $supplementary,
        ];
    }

    private function classify(string $lowerFilename, string $primaryExt): ?string
    {
        if (str_ends_with($lowerFilename, $primaryExt)) {
            return 'primary';
        }
        if (str_ends_with($lowerFilename, '.blockmap')) {
            return 'blockmap';
        }
        // electron-updater feed: latest.yml / latest-mac.yml / alpha.yml etc.
        if (str_ends_with($lowerFilename, '.yml') && str_starts_with($lowerFilename, 'latest')) {
            return 'metadata';
        }
        return null;
    }
}
