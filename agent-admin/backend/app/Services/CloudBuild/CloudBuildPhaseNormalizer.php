<?php

namespace App\Services\CloudBuild;

/**
 * 授权端 status + mirror_status → LAP-035 规范阶段。
 * 规则与 docs/contracts/cloud-build-migration/verify-fixture.cjs 同源。
 */
class CloudBuildPhaseNormalizer
{
    public const PHASE_QUEUED = 'queued';
    public const PHASE_BUILDING = 'building';
    public const PHASE_ARTIFACT_PENDING = 'artifact_pending';
    public const PHASE_READY = 'ready';
    public const PHASE_DELIVERED = 'delivered';
    public const PHASE_FAILED = 'failed';
    public const PHASE_CANCELLED = 'cancelled';
    public const PHASE_EXPIRED = 'expired';
    public const PHASE_PURGED = 'purged';
    public const PHASE_LEGACY = 'legacy_ready_or_unknown';

    public static function fromSource(string $status, ?string $mirrorStatus): string
    {
        if ($status === 'pending' || $status === 'queued') {
            return self::PHASE_QUEUED;
        }
        if ($status === 'building') {
            return self::PHASE_BUILDING;
        }
        if ($status === 'success' && in_array($mirrorStatus, ['pending', 'mirroring'], true)) {
            return self::PHASE_ARTIFACT_PENDING;
        }
        if ($status === 'success' && $mirrorStatus === 'mirrored') {
            return self::PHASE_READY;
        }
        if ($status === 'success' && $mirrorStatus === null) {
            return self::PHASE_LEGACY;
        }
        return $status;
    }
}
