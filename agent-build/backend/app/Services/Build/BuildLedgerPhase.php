<?php

namespace App\Services\Build;

/**
 * 与云控 CloudBuildPhaseNormalizer / verify-fixture.cjs 同源。
 */
class BuildLedgerPhase
{
    public static function fromSource(string $status, ?string $mirrorStatus): string
    {
        if ($status === 'pending' || $status === 'queued') {
            return 'queued';
        }
        if ($status === 'building') {
            return 'building';
        }
        if ($status === 'success' && in_array($mirrorStatus, ['pending', 'mirroring'], true)) {
            return 'artifact_pending';
        }
        if ($status === 'success' && $mirrorStatus === 'mirrored') {
            return 'ready';
        }
        if ($status === 'success' && $mirrorStatus === null) {
            return 'legacy_ready_or_unknown';
        }
        return $status;
    }
}
