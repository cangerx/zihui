<?php

namespace App\Services\SkillRegistry;

use App\Models\SkillRegistryEvent;
use App\Models\SkillRegistryReview;
use App\Models\SkillRegistrySkill;
use App\Models\SkillRegistryVersion;
use Carbon\Carbon;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Log;
use InvalidArgumentException;

class SkillRegistryService
{
    public function __construct(
        private SkillPackageScanner $scanner = new SkillPackageScanner(),
        private SkillSignatureService $signatures = new SkillSignatureService(),
        private SkillStateMachine $states = new SkillStateMachine(),
        private SkillDownloadTicketService $tickets = new SkillDownloadTicketService(),
        private string $storageRoot = '',
    ) {
        if ($this->storageRoot === '') {
            $this->storageRoot = storage_path('app/skill-registry');
        }
    }

    /**
     * @return array{ok:bool,error:?string,skill:?SkillRegistrySkill,version:?SkillRegistryVersion}
     */
    public function upload(string $zipPath, ?int $adminId = null): array
    {
        $scan = $this->scanner->scan($zipPath);
        if (!$scan['ok']) {
            return ['ok' => false, 'error' => $scan['error'], 'skill' => null, 'version' => null];
        }
        $manifest = $scan['manifest'];
        $skill = SkillRegistrySkill::query()->where('skill_id', $manifest['skill_id'])->first();
        if ($skill === null) {
            $skill = SkillRegistrySkill::query()->create([
                'skill_id' => $manifest['skill_id'],
                'slug' => $manifest['slug'],
                'name' => $manifest['name'],
                'status' => 'draft',
            ]);
        }
        if (SkillRegistryVersion::query()->where('skill_id', $manifest['skill_id'])->where('version', $manifest['version'])->exists()) {
            return ['ok' => false, 'error' => 'version_exists', 'skill' => $skill, 'version' => null];
        }
        $dir = $this->storageRoot . DIRECTORY_SEPARATOR . $manifest['skill_id'];
        if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
            return ['ok' => false, 'error' => 'package_unsafe', 'skill' => $skill, 'version' => null];
        }
        $dest = $dir . DIRECTORY_SEPARATOR . $manifest['version_id'] . '.zip';
        if (!copy($zipPath, $dest)) {
            return ['ok' => false, 'error' => 'package_unsafe', 'skill' => $skill, 'version' => null];
        }
        $version = SkillRegistryVersion::query()->create([
            'version_id' => $manifest['version_id'],
            'skill_id' => $manifest['skill_id'],
            'version' => $manifest['version'],
            'status' => 'pending_review',
            'sha256' => $scan['sha256'],
            'package_path' => $dest,
            'package_size' => $scan['package_size'],
            'file_count' => $scan['file_count'],
            'manifest_json' => $manifest,
            'permissions_json' => $manifest['permissions'],
            'scan_report' => [
                'ok' => true,
                'file_count' => $scan['file_count'],
                'package_size' => $scan['package_size'],
            ],
            'uploaded_by' => $adminId,
        ]);
        $this->appendEvent('version_uploaded', $skill->skill_id, $version->version_id, [
            'version' => $version->version,
            'sha256' => $version->sha256,
        ]);
        return ['ok' => true, 'error' => null, 'skill' => $skill, 'version' => $version];
    }

    public function review(string $versionId, string $action, ?int $reviewerId, string $evidence = ''): SkillRegistryVersion
    {
        $version = $this->versionOrFail($versionId);
        if ($action === 'approve') {
            $this->states->assertVersion($version->status, 'published');
            return $this->publish($version, $reviewerId, $evidence);
        }
        if ($action !== 'reject') {
            throw new InvalidArgumentException('unknown_review_action');
        }
        $this->states->assertVersion($version->status, 'rejected');
        $version->status = 'rejected';
        $version->reject_reason = mb_substr($evidence, 0, 500);
        $version->save();
        SkillRegistryReview::query()->create([
            'version_id' => $version->version_id,
            'action' => 'reject',
            'reviewer_id' => $reviewerId,
            'evidence' => mb_substr($evidence, 0, 2000),
        ]);
        $this->appendEvent('version_rejected', $version->skill_id, $version->version_id, ['reason' => $version->reject_reason]);
        return $version->fresh();
    }

    public function publish(SkillRegistryVersion $version, ?int $reviewerId, string $evidence = ''): SkillRegistryVersion
    {
        $this->states->assertVersion($version->status, 'published');
        $publishedAt = Carbon::now()->utc()->toIso8601String();
        $signed = $this->signatures->sign([
            'skill_id' => $version->skill_id,
            'version_id' => $version->version_id,
            'version' => $version->version,
            'sha256' => $version->sha256,
            'published_at' => $publishedAt,
        ]);
        $version->status = 'published';
        $version->signature = $signed['signature'];
        $version->signature_algorithm = 'ed25519';
        $version->key_id = $signed['key_id'];
        $version->published_at = Carbon::parse($publishedAt);
        $version->save();
        SkillRegistryReview::query()->create([
            'version_id' => $version->version_id,
            'action' => 'publish',
            'reviewer_id' => $reviewerId,
            'evidence' => mb_substr($evidence, 0, 2000),
        ]);
        $skill = SkillRegistrySkill::query()->where('skill_id', $version->skill_id)->first();
        if ($skill && $skill->status === 'draft') {
            $this->states->assertSkill($skill->status, 'active');
            $skill->status = 'active';
            $skill->save();
        }
        $this->appendEvent('version_published', $version->skill_id, $version->version_id, [
            'version' => $version->version,
            'sha256' => $version->sha256,
            'key_id' => $version->key_id,
            'published_at' => $publishedAt,
        ]);
        return $version->fresh();
    }

    public function revoke(string $versionId, ?int $reviewerId, string $evidence = ''): SkillRegistryVersion
    {
        $version = $this->versionOrFail($versionId);
        $this->states->assertVersion($version->status, 'revoked');
        $path = $version->package_path;
        $version->status = 'revoked';
        $version->revoked_at = Carbon::now();
        $version->save();
        if ($path && $version->package_path !== $path) {
            throw new InvalidArgumentException('package_mutated');
        }
        SkillRegistryReview::query()->create([
            'version_id' => $version->version_id,
            'action' => 'revoke',
            'reviewer_id' => $reviewerId,
            'evidence' => mb_substr($evidence, 0, 2000),
        ]);
        $this->appendEvent('version_revoked', $version->skill_id, $version->version_id, [
            'version' => $version->version,
            'sha256' => $version->sha256,
        ]);
        return $version->fresh();
    }

    /**
     * @return array{data:list<array<string,mixed>>,next_cursor:?int,has_more:bool}
     */
    public function events(int $after = 0, int $limit = 100): array
    {
        $limit = max(1, min(500, $limit));
        $rows = SkillRegistryEvent::query()
            ->where('id', '>', $after)
            ->orderBy('id')
            ->limit($limit + 1)
            ->get();
        $hasMore = $rows->count() > $limit;
        $page = $rows->take($limit)->values();
        $data = [];
        $prev = $after;
        foreach ($page as $row) {
            if ((int) $row->id !== $prev + 1 && $prev !== $after) {
                // 允许 after 跳跃到最新连续段之前；批次内部必须连续
            }
            $data[] = [
                'cursor' => (int) $row->id,
                'event_type' => $row->event_type,
                'skill_id' => $row->skill_id,
                'version_id' => $row->version_id,
                'payload' => $row->payload_json,
                'created_at' => optional($row->created_at)->toIso8601String(),
            ];
            $prev = (int) $row->id;
        }
        for ($i = 1; $i < count($data); $i++) {
            if ($data[$i]['cursor'] !== $data[$i - 1]['cursor'] + 1) {
                throw new InvalidArgumentException('cursor_gap');
            }
        }
        $next = $data ? (int) $data[count($data) - 1]['cursor'] : $after;
        return ['data' => $data, 'next_cursor' => $next, 'has_more' => $hasMore];
    }

    /**
     * @return array<string, mixed>
     */
    public function downloadTicket(string $versionId): array
    {
        $version = $this->versionOrFail($versionId);
        $skill = SkillRegistrySkill::query()->where('skill_id', $version->skill_id)->first();
        if ($version->status === 'revoked') {
            return ['error' => 'version_revoked', 'status' => 409];
        }
        if ($version->status !== 'published') {
            return ['error' => 'version_not_published', 'status' => 409];
        }
        if (!$skill || $skill->status !== 'active') {
            return ['error' => 'skill_not_available', 'status' => 409];
        }
        $ticket = $this->tickets->issue(
            $version->version_id,
            (string) $version->sha256,
            (string) $version->signature,
            (string) $version->key_id
        );
        if ($ticket === null) {
            return ['error' => 'download_ticket_expired', 'status' => 503];
        }
        return ['status' => 200, 'body' => $ticket];
    }

    public function resolveDownload(string $token): array
    {
        $parsed = $this->tickets->verify($token);
        if ($parsed === null) {
            return ['error' => 'download_ticket_expired', 'status' => 410];
        }
        $version = SkillRegistryVersion::query()->where('version_id', $parsed['version_id'])->first();
        if ($version === null || $version->status !== 'published') {
            return ['error' => 'version_not_published', 'status' => 409];
        }
        if ($version->sha256 !== $parsed['sha256']) {
            return ['error' => 'digest_mismatch', 'status' => 409];
        }
        if (!is_file((string) $version->package_path)) {
            return ['error' => 'version_not_found', 'status' => 404];
        }
        return ['status' => 200, 'path' => $version->package_path, 'filename' => $version->version_id . '.zip'];
    }

    public function storeUploadedFile(UploadedFile $file): string
    {
        $tmp = tempnam(sys_get_temp_dir(), 'skillzip');
        $file->move(dirname($tmp), basename($tmp));
        return dirname($tmp) . DIRECTORY_SEPARATOR . basename($tmp);
    }

    private function versionOrFail(string $versionId): SkillRegistryVersion
    {
        $version = SkillRegistryVersion::query()->where('version_id', $versionId)->first();
        if ($version === null) {
            throw new InvalidArgumentException('version_not_found');
        }
        return $version;
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function appendEvent(string $type, string $skillId, ?string $versionId, array $payload): void
    {
        SkillRegistryEvent::query()->create([
            'event_type' => $type,
            'skill_id' => $skillId,
            'version_id' => $versionId,
            'payload_json' => $payload,
            'created_at' => Carbon::now(),
        ]);
        try {
            Log::info('skill_registry_event', ['event_type' => $type, 'skill_id' => $skillId, 'version_id' => $versionId]);
        } catch (\Throwable $e) {
            // 单测 harness 可能未绑定 log 通道
        }
    }
}
