<?php

namespace App\Services\CloudBuild;

use App\Models\CloudBuildJob;
use InvalidArgumentException;

class CloudBuildJobClaimer
{
    public function __construct(private CloudBuildStateMachine $stateMachine)
    {
    }

    /**
     * 原子领取：行锁 + 期望阶段 + 空闲 claim_owner。
     * 第二个 worker 对同一 build_id 得到 null。
     */
    public function claim(string $buildId, string $owner, string $expectedPhase): ?CloudBuildJob
    {
        if ($owner === '') {
            throw new InvalidArgumentException('claim owner required');
        }

        return CloudBuildJob::query()->getConnection()->transaction(function () use ($buildId, $owner, $expectedPhase) {
            /** @var CloudBuildJob|null $job */
            $job = CloudBuildJob::query()
                ->where('build_id', $buildId)
                ->lockForUpdate()
                ->first();

            if ($job === null) {
                return null;
            }
            if ($job->phase !== $expectedPhase) {
                return null;
            }
            if ($job->claim_owner !== null && $job->claim_owner !== $owner) {
                return null;
            }

            $job->claim_owner = $owner;
            $job->claimed_at = now();
            $job->save();

            return $job->fresh();
        });
    }

    public function transition(CloudBuildJob $job, string $to, array $attributes = []): CloudBuildJob
    {
        return CloudBuildJob::query()->getConnection()->transaction(function () use ($job, $to, $attributes) {
            /** @var CloudBuildJob|null $locked */
            $locked = CloudBuildJob::query()
                ->where('id', $job->id)
                ->lockForUpdate()
                ->first();
            if ($locked === null) {
                throw new InvalidArgumentException('cloud-build job missing');
            }

            $this->stateMachine->assertCanTransition((string) $locked->phase, $to);
            $locked->fill($attributes);
            $locked->phase = $to;
            if (in_array($to, CloudBuildStateMachine::TERMINAL, true)
                || $to === CloudBuildPhaseNormalizer::PHASE_DELIVERED) {
                $locked->claim_owner = null;
                $locked->claimed_at = null;
            }
            $locked->save();

            return $locked->fresh();
        });
    }
}
