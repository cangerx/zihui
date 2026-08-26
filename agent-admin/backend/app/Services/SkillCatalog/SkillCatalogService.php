<?php

namespace App\Services\SkillCatalog;

use App\Models\SkillCatalogSkill;
use App\Models\SkillCatalogSyncState;
use App\Models\SkillCatalogTenantPolicy;
use App\Models\SkillCatalogVersion;

class SkillCatalogService
{
    public function __construct(
        private SkillCatalogDownloadTicketService $tickets = new SkillCatalogDownloadTicketService(),
        private SkillSignatureService $signatures = new SkillSignatureService(),
    ) {
    }

    /**
     * @return array{data:list<array<string,mixed>>,sync:?array<string,mixed>}
     */
    public function adminIndex(): array
    {
        $skills = SkillCatalogSkill::query()->orderByDesc('id')->limit(500)->get();
        $data = [];
        foreach ($skills as $skill) {
            $data[] = $this->adminSkillPayload($skill);
        }
        $sync = SkillCatalogSyncState::query()->first();
        return [
            'data' => $data,
            'sync' => $sync ? [
                'cursor' => (int) $sync->cursor,
                'last_error' => (string) $sync->last_error,
                'last_success_at' => $sync->last_success_at ? $sync->last_success_at->toIso8601String() : null,
            ] : ['cursor' => 0, 'last_error' => '', 'last_success_at' => null],
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function adminShow(string $skillId): ?array
    {
        $skill = SkillCatalogSkill::query()->where('skill_id', $skillId)->first();
        if ($skill === null) {
            return null;
        }
        $versions = SkillCatalogVersion::query()->where('skill_id', $skillId)->orderByDesc('id')->get()
            ->map(fn ($row) => $this->versionPayload($row))->all();
        $policies = SkillCatalogTenantPolicy::query()->where('skill_id', $skillId)->get();
        return [
            'skill' => $this->adminSkillPayload($skill),
            'versions' => $versions,
            'policies' => $policies,
        ];
    }

    /**
     * @param array{category?:string,recommended?:bool,listed?:bool,status?:string} $patch
     */
    public function updateSkill(string $skillId, array $patch, int $tenantId = 0): SkillCatalogSkill
    {
        $skill = SkillCatalogSkill::query()->where('skill_id', $skillId)->first();
        if ($skill === null) {
            throw new \InvalidArgumentException('skill_not_found');
        }
        if (array_key_exists('category', $patch)) {
            $skill->category = (string) $patch['category'];
        }
        if (array_key_exists('recommended', $patch)) {
            $skill->recommended = (bool) $patch['recommended'];
        }
        if (array_key_exists('status', $patch) && in_array($patch['status'], ['active', 'suspended'], true)) {
            $skill->status = (string) $patch['status'];
        }
        $skill->save();
        if (array_key_exists('listed', $patch)) {
            $this->setListed($skillId, $tenantId, (bool) $patch['listed']);
        }
        return $skill->fresh();
    }

    public function setListed(string $skillId, int $tenantId, bool $listed): SkillCatalogTenantPolicy
    {
        if (!SkillCatalogSkill::query()->where('skill_id', $skillId)->exists()) {
            throw new \InvalidArgumentException('skill_not_found');
        }
        return SkillCatalogTenantPolicy::query()->updateOrCreate(
            ['tenant_id' => $tenantId, 'skill_id' => $skillId],
            ['listed' => $listed]
        );
    }

    public function isListed(string $skillId, int $tenantId): bool
    {
        $user = SkillCatalogTenantPolicy::query()
            ->where('skill_id', $skillId)
            ->where('tenant_id', $tenantId)
            ->first();
        if ($user) {
            return (bool) $user->listed;
        }
        $global = SkillCatalogTenantPolicy::query()
            ->where('skill_id', $skillId)
            ->where('tenant_id', 0)
            ->first();
        if ($global) {
            return (bool) $global->listed;
        }
        return true;
    }

    /**
     * @return array{data:list<array<string,mixed>>,next_cursor:?string,keys:list<array{key_id:string,public_key:string}>}
     */
    public function clientCatalog(int $tenantId, string $cursor = ''): array
    {
        $skills = SkillCatalogSkill::query()->where('status', 'active')->orderBy('id')->get();
        $data = [];
        foreach ($skills as $skill) {
            if (!$this->isListed($skill->skill_id, $tenantId)) {
                continue;
            }
            $version = SkillCatalogVersion::query()
                ->where('skill_id', $skill->skill_id)
                ->where('status', 'published')
                ->orderByDesc('id')
                ->first();
            if ($version === null) {
                continue;
            }
            $data[] = [
                'skill_id' => $skill->skill_id,
                'slug' => $skill->slug,
                'name' => $skill->name,
                'description' => $this->manifestDescription($version),
                'category' => $skill->category,
                'recommended' => (bool) $skill->recommended,
                'version' => $version->version,
                'version_id' => $version->version_id,
                'sha256' => $version->sha256,
                'signature' => $version->signature,
                'key_id' => $version->key_id,
                'published_at' => (is_array($version->manifest_json) ? ($version->manifest_json['signed_published_at'] ?? null) : null)
                    ?: ($version->published_at ? $version->published_at->toIso8601String() : null),
                'permissions' => $version->permissions_json,
                'reviewed' => true,
                'status' => 'published',
            ];
        }
        return [
            'data' => $data,
            'next_cursor' => $cursor === '' ? (string) (SkillCatalogSyncState::query()->value('cursor') ?: 0) : $cursor,
            'keys' => $this->signatures->publicKeys(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function clientDownloadTicket(string $versionId, int $tenantId): array
    {
        $version = SkillCatalogVersion::query()->where('version_id', $versionId)->first();
        if ($version === null) {
            return ['error' => 'version_not_found', 'status' => 404];
        }
        if ($version->status === 'revoked') {
            return ['error' => 'version_revoked', 'status' => 409];
        }
        if ($version->status !== 'published') {
            return ['error' => 'version_not_published', 'status' => 409];
        }
        $skill = SkillCatalogSkill::query()->where('skill_id', $version->skill_id)->first();
        if ($skill === null || $skill->status !== 'active') {
            return ['error' => 'skill_not_available', 'status' => 409];
        }
        if (!$this->isListed($version->skill_id, $tenantId)) {
            return ['error' => 'tenant_skill_disabled', 'status' => 409];
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

    /**
     * @return array<string, mixed>
     */
    public function resolveDownload(string $token): array
    {
        $parsed = $this->tickets->verify($token);
        if ($parsed === null) {
            return ['error' => 'download_ticket_expired', 'status' => 410];
        }
        $version = SkillCatalogVersion::query()->where('version_id', $parsed['version_id'])->first();
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

    /**
     * @return array<string, mixed>
     */
    private function adminSkillPayload(SkillCatalogSkill $skill): array
    {
        $latest = SkillCatalogVersion::query()
            ->where('skill_id', $skill->skill_id)
            ->orderByDesc('id')
            ->first();
        $global = SkillCatalogTenantPolicy::query()
            ->where('skill_id', $skill->skill_id)
            ->where('tenant_id', 0)
            ->first();
        return [
            'skill_id' => $skill->skill_id,
            'slug' => $skill->slug,
            'name' => $skill->name,
            'description' => $this->manifestDescription($latest),
            'status' => $skill->status,
            'category' => $skill->category,
            'recommended' => (bool) $skill->recommended,
            'listed' => $global ? (bool) $global->listed : true,
            'latest_version' => $latest?->version,
            'latest_status' => $latest?->status,
        ];
    }

    private function manifestDescription(?SkillCatalogVersion $version): string
    {
        if ($version === null || !is_array($version->manifest_json)) {
            return '';
        }
        $description = $version->manifest_json['description'] ?? '';
        return is_string($description) ? $description : '';
    }

    /**
     * @return array<string, mixed>
     */
    private function versionPayload(SkillCatalogVersion $row): array
    {
        return [
            'version_id' => $row->version_id,
            'skill_id' => $row->skill_id,
            'version' => $row->version,
            'status' => $row->status,
            'sha256' => $row->sha256,
            'key_id' => $row->key_id,
            'permissions' => $row->permissions_json,
            'published_at' => $row->published_at ? $row->published_at->toIso8601String() : null,
            'revoked_at' => $row->revoked_at ? $row->revoked_at->toIso8601String() : null,
        ];
    }
}
