<?php

namespace App\Services\CloudBuild;

use App\Models\CloudBuildArtifact;
use App\Models\CloudBuildJob;
use App\Models\CloudBuildQuota;
use Carbon\Carbon;
use InvalidArgumentException;

/**
 * 源 ledger 文件对云控执行账本的硬差异报告。零硬差异才允许进入 T5.2。
 */
class CloudBuildLedgerReconcileService
{
    /**
     * @param array<string, mixed> $file
     * @return array<string, mixed>
     */
    public function reconcile(array $file): array
    {
        $file = CloudBuildLedgerFile::assertIntact($file);
        $sourceJobs = $file['jobs'] ?? [];
        $sourceCanon = [];
        foreach ($sourceJobs as $row) {
            $canon = CloudBuildLedgerCanonical::canonicalJob($row, true);
            $sourceCanon[$canon['build_id']] = $canon;
        }

        $ids = array_keys($sourceCanon);
        sort($ids);
        $min = $ids[0] ?? null;
        $max = $ids ? $ids[count($ids) - 1] : null;

        $targetJobs = CloudBuildJob::query()
            ->when($min && $max, function ($q) use ($min, $max) {
                $q->where('build_id', '>=', $min)->where('build_id', '<=', $max);
            })
            ->get();

        $targetCanon = [];
        foreach ($targetJobs as $job) {
            $arts = CloudBuildArtifact::query()->where('build_id', $job->build_id)->get()->map(fn ($a) => [
                'filename' => $a->filename,
                'role' => $a->role,
                'size' => (int) $a->size,
                'sha256' => $a->sha256,
            ])->all();
            $targetCanon[$job->build_id] = CloudBuildLedgerCanonical::canonicalJob([
                'build_id' => $job->build_id,
                'client_ref' => $job->client_ref,
                'platform' => $job->platform,
                'build_mode' => $job->build_mode,
                'oem_project_key' => $job->oem_project_key,
                'phase' => $job->phase,
                'attempt_count' => (int) $job->dispatch_attempts,
                'executor_run_id' => $job->executor_run_id,
                'artifacts' => $arts,
            ], false);
        }

        $missing = array_values(array_diff($ids, array_keys($targetCanon)));
        $extra = array_values(array_diff(array_keys($targetCanon), $ids));
        $phaseMismatch = [];
        $terminalResurrected = [];
        $artifactMismatch = [];
        $attemptMismatch = [];
        $legacyUnknown = [];

        foreach ($sourceCanon as $buildId => $src) {
            $dst = $targetCanon[$buildId] ?? null;
            if ($dst === null) {
                continue;
            }
            if ($src['phase'] !== $dst['phase']) {
                $phaseMismatch[] = ['build_id' => $buildId, 'source' => $src['phase'], 'target' => $dst['phase']];
            }
            if (in_array($src['phase'], CloudBuildLedgerCanonical::TERMINAL, true)
                && in_array($dst['phase'], CloudBuildLedgerCanonical::ACTIVE, true)) {
                $terminalResurrected[] = $buildId;
            }
            if ($src['attempt_count'] !== $dst['attempt_count']) {
                $attemptMismatch[] = ['build_id' => $buildId, 'source' => $src['attempt_count'], 'target' => $dst['attempt_count']];
            }
            if ($src['artifacts'] !== $dst['artifacts']) {
                $artifactMismatch[] = $buildId;
            }
            if ($src['phase'] === CloudBuildPhaseNormalizer::PHASE_LEGACY
                || $dst['phase'] === CloudBuildPhaseNormalizer::PHASE_LEGACY) {
                $legacyUnknown[] = $buildId;
            }
        }

        $sourceDigest = CloudBuildLedgerCanonical::digest(array_values($sourceCanon), false);
        $targetDigest = CloudBuildLedgerCanonical::digest(array_values($targetCanon), false);

        $quotaDiffs = [];
        foreach (($file['quotas'] ?? []) as $quota) {
            if (!is_array($quota)) {
                continue;
            }
            $ref = (string) ($quota['client_ref'] ?? '');
            $date = (string) ($quota['quota_date'] ?? $quota['date'] ?? '');
            $expected = (int) ($quota['consumed'] ?? $quota['count'] ?? 0);
            $actual = 0;
            if ($ref !== '' && $date !== '') {
                $row = CloudBuildQuota::query()
                    ->where('client_ref', $ref)
                    ->whereDate('quota_date', Carbon::parse($date)->toDateString())
                    ->first();
                $actual = $row ? (int) $row->consumed : 0;
            }
            if ($expected !== $actual) {
                $quotaDiffs[] = ['client_ref' => $ref, 'quota_date' => $date, 'source' => $expected, 'target' => $actual];
            }
        }

        $hard = [];
        if ($missing !== []) {
            $hard[] = 'missing_build_ids';
        }
        if ($extra !== []) {
            $hard[] = 'extra_build_ids';
        }
        if ($phaseMismatch !== []) {
            $hard[] = 'phase_mismatch';
        }
        if ($terminalResurrected !== []) {
            $hard[] = 'terminal_resurrected';
        }
        if ($attemptMismatch !== []) {
            $hard[] = 'attempt_mismatch';
        }
        if ($artifactMismatch !== []) {
            $hard[] = 'artifact_mismatch';
        }
        if ($sourceDigest !== $targetDigest) {
            $hard[] = 'canonical_digest_mismatch';
        }
        if ($quotaDiffs !== []) {
            $hard[] = 'quota_mismatch';
        }

        $sourceTerminal = 0;
        foreach ($sourceCanon as $src) {
            if (in_array($src['phase'], CloudBuildLedgerCanonical::TERMINAL, true)) {
                $sourceTerminal++;
            }
        }
        $targetTerminal = 0;
        foreach ($targetCanon as $dst) {
            if (in_array($dst['phase'], CloudBuildLedgerCanonical::TERMINAL, true)) {
                $targetTerminal++;
            }
        }
        if ($sourceTerminal !== $targetTerminal) {
            $hard[] = 'terminal_count_mismatch';
        }
        $hard = array_values(array_unique($hard));

        return [
            'ok' => $hard === [],
            'hard_diffs' => $hard,
            'range' => ['build_id_min' => $min, 'build_id_max' => $max, 'jobs' => count($ids)],
            'missing_build_ids' => $missing,
            'extra_build_ids' => $extra,
            'phase_mismatch' => $phaseMismatch,
            'terminal_resurrected' => $terminalResurrected,
            'attempt_mismatch' => $attemptMismatch,
            'artifact_mismatch' => $artifactMismatch,
            'quota_mismatch' => $quotaDiffs,
            'legacy_ready_or_unknown' => $legacyUnknown,
            'source_terminal' => $sourceTerminal,
            'target_terminal' => $targetTerminal,
            'canonical_sha256_source' => $sourceDigest,
            'canonical_sha256_target' => $targetDigest,
        ];
    }

    public function reconcilePath(string $path): array
    {
        if (!is_file($path)) {
            throw new InvalidArgumentException('ledger_file_not_found');
        }
        $decoded = json_decode((string) file_get_contents($path), true);
        if (!is_array($decoded)) {
            throw new InvalidArgumentException('ledger_file_invalid_json');
        }
        return $this->reconcile($decoded);
    }
}
