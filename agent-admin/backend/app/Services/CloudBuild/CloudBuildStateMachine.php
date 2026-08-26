<?php

namespace App\Services\CloudBuild;

use InvalidArgumentException;

/**
 * 规范阶段状态机。终态不得复活为活动态；未列出的跃迁一律拒绝。
 */
class CloudBuildStateMachine
{
    public const TERMINAL = [
        CloudBuildPhaseNormalizer::PHASE_FAILED,
        CloudBuildPhaseNormalizer::PHASE_CANCELLED,
        CloudBuildPhaseNormalizer::PHASE_EXPIRED,
        CloudBuildPhaseNormalizer::PHASE_PURGED,
    ];

    public const ACTIVE = [
        CloudBuildPhaseNormalizer::PHASE_QUEUED,
        CloudBuildPhaseNormalizer::PHASE_BUILDING,
        CloudBuildPhaseNormalizer::PHASE_ARTIFACT_PENDING,
        CloudBuildPhaseNormalizer::PHASE_READY,
        CloudBuildPhaseNormalizer::PHASE_LEGACY,
    ];

    /** @var array<string, string[]> */
    private const TRANSITIONS = [
        CloudBuildPhaseNormalizer::PHASE_QUEUED => [
            CloudBuildPhaseNormalizer::PHASE_BUILDING,
            CloudBuildPhaseNormalizer::PHASE_FAILED,
            CloudBuildPhaseNormalizer::PHASE_CANCELLED,
        ],
        CloudBuildPhaseNormalizer::PHASE_BUILDING => [
            CloudBuildPhaseNormalizer::PHASE_ARTIFACT_PENDING,
            CloudBuildPhaseNormalizer::PHASE_READY,
            CloudBuildPhaseNormalizer::PHASE_FAILED,
            CloudBuildPhaseNormalizer::PHASE_CANCELLED,
        ],
        CloudBuildPhaseNormalizer::PHASE_ARTIFACT_PENDING => [
            CloudBuildPhaseNormalizer::PHASE_READY,
            CloudBuildPhaseNormalizer::PHASE_FAILED,
        ],
        CloudBuildPhaseNormalizer::PHASE_READY => [
            CloudBuildPhaseNormalizer::PHASE_DELIVERED,
            CloudBuildPhaseNormalizer::PHASE_EXPIRED,
            CloudBuildPhaseNormalizer::PHASE_FAILED,
        ],
        CloudBuildPhaseNormalizer::PHASE_DELIVERED => [
            CloudBuildPhaseNormalizer::PHASE_PURGED,
        ],
        CloudBuildPhaseNormalizer::PHASE_FAILED => [],
        CloudBuildPhaseNormalizer::PHASE_CANCELLED => [],
        CloudBuildPhaseNormalizer::PHASE_EXPIRED => [],
        CloudBuildPhaseNormalizer::PHASE_PURGED => [],
        CloudBuildPhaseNormalizer::PHASE_LEGACY => [
            CloudBuildPhaseNormalizer::PHASE_READY,
            CloudBuildPhaseNormalizer::PHASE_DELIVERED,
            CloudBuildPhaseNormalizer::PHASE_EXPIRED,
            CloudBuildPhaseNormalizer::PHASE_FAILED,
        ],
    ];

    public function canTransition(string $from, string $to): bool
    {
        if ($from === $to) {
            return true;
        }
        $allowed = self::TRANSITIONS[$from] ?? null;
        if ($allowed === null) {
            return false;
        }
        return in_array($to, $allowed, true);
    }

    public function assertCanTransition(string $from, string $to): void
    {
        if (!$this->canTransition($from, $to)) {
            throw new InvalidArgumentException("illegal cloud-build phase transition: {$from} -> {$to}");
        }
        if (in_array($from, self::TERMINAL, true) && in_array($to, self::ACTIVE, true)) {
            throw new InvalidArgumentException("terminal cloud-build phase cannot resurrect: {$from} -> {$to}");
        }
    }
}
