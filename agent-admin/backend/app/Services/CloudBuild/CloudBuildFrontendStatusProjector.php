<?php

namespace App\Services\CloudBuild;

/**
 * 把规范阶段投影回现有 cloud_builds / oem_builds 前端状态。
 * downloading 仍是本地拉取态，不属于规范阶段。
 */
class CloudBuildFrontendStatusProjector
{
    public const FRONTEND_STATUSES = [
        'queued',
        'building',
        'success',
        'downloading',
        'delivered',
        'failed',
        'cancelled',
        'expired',
        'purged',
    ];

    public function fromPhase(string $phase, ?string $localStatus = null): string
    {
        if ($localStatus === 'downloading') {
            return 'downloading';
        }

        return match ($phase) {
            CloudBuildPhaseNormalizer::PHASE_QUEUED => 'queued',
            CloudBuildPhaseNormalizer::PHASE_BUILDING => 'building',
            CloudBuildPhaseNormalizer::PHASE_ARTIFACT_PENDING,
            CloudBuildPhaseNormalizer::PHASE_READY,
            CloudBuildPhaseNormalizer::PHASE_LEGACY => 'success',
            CloudBuildPhaseNormalizer::PHASE_DELIVERED => 'delivered',
            CloudBuildPhaseNormalizer::PHASE_FAILED => 'failed',
            CloudBuildPhaseNormalizer::PHASE_CANCELLED => 'cancelled',
            CloudBuildPhaseNormalizer::PHASE_EXPIRED => 'expired',
            CloudBuildPhaseNormalizer::PHASE_PURGED => 'purged',
            default => throw new \InvalidArgumentException("unknown cloud-build phase: {$phase}"),
        };
    }
}
