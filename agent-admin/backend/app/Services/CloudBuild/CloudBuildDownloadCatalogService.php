<?php

namespace App\Services\CloudBuild;

use App\Models\CloudBuildArtifact;
use App\Models\CloudBuildJob;

class CloudBuildDownloadCatalogService
{
    public function __construct(
        private CloudBuildSignatureService $signatures,
        private CloudBuildArtifactStore $store,
    ) {
    }

    /**
     * @return array{status:int,body:array<string,mixed>}
     */
    public function catalog(string $buildId): array
    {
        $job = CloudBuildJob::query()->where('build_id', $buildId)->first();
        if ($job === null) {
            return ['status' => 404, 'body' => ['error' => 'build_not_found']];
        }

        $phase = (string) $job->phase;
        if (in_array($phase, [
            CloudBuildPhaseNormalizer::PHASE_EXPIRED,
            CloudBuildPhaseNormalizer::PHASE_PURGED,
        ], true)) {
            return ['status' => 410, 'body' => ['error' => 'artifact_expired_or_purged', 'phase' => $phase]];
        }
        if ($phase !== CloudBuildPhaseNormalizer::PHASE_READY
            && $phase !== CloudBuildPhaseNormalizer::PHASE_DELIVERED) {
            return ['status' => 425, 'body' => ['error' => 'not_ready', 'phase' => $phase]];
        }

        $artifacts = CloudBuildArtifact::query()->where('build_id', $buildId)->get();
        $primary = $artifacts->firstWhere('role', 'primary');
        if ($primary === null || empty($primary->storage_path) || !is_file($primary->storage_path)) {
            return ['status' => 503, 'body' => ['error' => 'primary_missing']];
        }

        $signed = $this->signatures->generate((string) $job->build_id, (string) $job->client_ref, (string) $primary->filename);
        if ($signed === null) {
            return ['status' => 503, 'body' => ['error' => 'sign_secret_missing']];
        }

        $primaryPayload = [
            'url' => $signed['url'],
            'filename' => $primary->filename,
            'size' => (int) $primary->size,
            'sha256' => (string) $primary->sha256,
        ];
        $supplementary = [];
        foreach ($artifacts as $artifact) {
            if ($artifact->role === 'primary') {
                continue;
            }
            $s = $this->signatures->generate((string) $job->build_id, (string) $job->client_ref, (string) $artifact->filename);
            if ($s === null || empty($artifact->storage_path)) {
                continue;
            }
            $supplementary[] = [
                'url' => $s['url'],
                'filename' => $artifact->filename,
                'role' => $artifact->role,
                'size' => (int) $artifact->size,
                'sha256' => (string) $artifact->sha256,
            ];
        }

        return [
            'status' => 200,
            'body' => [
                'build_id' => $job->build_id,
                'phase' => $phase,
                'primary' => $primaryPayload,
                'supplementary_files' => $supplementary,
                'expires_at' => date('c', $signed['expires_at']),
            ],
        ];
    }

    /**
     * @return array{status:int,path:?string,filename:?string,error:?string}
     */
    public function resolveFile(string $token): array
    {
        $claims = $this->signatures->verify($token);
        if ($claims === null) {
            return ['status' => 401, 'path' => null, 'filename' => null, 'error' => 'invalid_or_expired_signature'];
        }
        $job = CloudBuildJob::query()->where('build_id', $claims['build_id'])->first();
        if ($job === null || $job->client_ref !== $claims['client_ref']) {
            return ['status' => 404, 'path' => null, 'filename' => null, 'error' => 'build_not_found'];
        }
        try {
            $path = $this->store->finalPath($claims['build_id'], $claims['filename']);
        } catch (\InvalidArgumentException $e) {
            return ['status' => 400, 'path' => null, 'filename' => null, 'error' => 'invalid_filename'];
        }
        if (!is_file($path)) {
            return ['status' => 404, 'path' => null, 'filename' => null, 'error' => 'file_not_found'];
        }
        return ['status' => 200, 'path' => $path, 'filename' => $claims['filename'], 'error' => null];
    }
}
