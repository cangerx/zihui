<?php

namespace App\Services\SkillCatalog;

use App\Models\SkillCatalogSkill;
use App\Models\SkillCatalogSyncState;
use App\Models\SkillCatalogVersion;
use Carbon\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class SkillCatalogSyncService
{
    public function __construct(
        private SkillPackageScanner $scanner = new SkillPackageScanner(),
        private SkillSignatureService $signatures = new SkillSignatureService(),
        private string $baseUrl = '',
        private string $syncToken = '',
        private string $storageRoot = '',
    ) {
        if ($this->baseUrl === '') {
            $this->baseUrl = rtrim($this->envOr('skill_catalog.registry_base_url', 'SKILL_REGISTRY_BASE_URL'), '/');
        }
        if ($this->syncToken === '') {
            $this->syncToken = $this->envOr('skill_catalog.sync_token', 'SKILL_REGISTRY_SYNC_TOKEN');
        }
        if ($this->storageRoot === '') {
            try {
                $this->storageRoot = storage_path('app/skill-catalog');
            } catch (\Throwable $e) {
                $this->storageRoot = sys_get_temp_dir() . '/skill-catalog';
            }
        }
    }

    private function envOr(string $configKey, string $envKey): string
    {
        try {
            $value = config($configKey);
            if (is_string($value) && $value !== '') {
                return $value;
            }
        } catch (\Throwable $e) {
        }
        return (string) (getenv($envKey) ?: '');
    }

    /**
     * @return array{ok:bool,applied:int,error:?string,cursor:int}
     */
    public function sync(?callable $httpGet = null, ?callable $httpPost = null): array
    {
        $state = SkillCatalogSyncState::query()->first() ?: SkillCatalogSyncState::query()->create(['cursor' => 0]);
        $cursor = (int) $state->cursor;
        if ($this->baseUrl === '' || $this->syncToken === '') {
            return ['ok' => true, 'applied' => 0, 'error' => null, 'cursor' => $cursor];
        }
        try {
            $batch = $this->fetchEvents($cursor, $httpGet);
            $events = $batch['data'] ?? [];
            if ($events === []) {
                $state->last_error = '';
                $state->last_success_at = Carbon::now();
                $state->save();
                return ['ok' => true, 'applied' => 0, 'error' => null, 'cursor' => $cursor];
            }
            $expected = $cursor + 1;
            if ((int) $events[0]['cursor'] !== $expected) {
                throw new \RuntimeException('cursor_gap');
            }
            for ($i = 1; $i < count($events); $i++) {
                if ((int) $events[$i]['cursor'] !== (int) $events[$i - 1]['cursor'] + 1) {
                    throw new \RuntimeException('cursor_gap');
                }
            }
            $applied = 0;
            $conn = SkillCatalogSkill::query()->getConnection();
            $conn->transaction(function () use ($events, $httpPost, $httpGet, $state, &$cursor, &$applied) {
                foreach ($events as $event) {
                    $this->applyEvent($event, $httpPost, $httpGet);
                    $cursor = (int) $event['cursor'];
                    $applied++;
                }
                $state->cursor = $cursor;
                $state->last_error = '';
                $state->last_success_at = Carbon::now();
                $state->save();
            });
            return ['ok' => true, 'applied' => $applied, 'error' => null, 'cursor' => $cursor];
        } catch (\Throwable $e) {
            try {
                Log::warning('skill_catalog_sync_failed', ['error' => $e->getMessage()]);
            } catch (\Throwable $ignored) {
            }
            $state->last_error = mb_substr($e->getMessage(), 0, 500);
            $state->save();
            return ['ok' => false, 'applied' => 0, 'error' => $e->getMessage(), 'cursor' => (int) $state->cursor];
        }
    }

    /**
     * @param array<string, mixed> $event
     */
    private function applyEvent(array $event, ?callable $httpPost, ?callable $httpGet): void
    {
        $type = (string) ($event['event_type'] ?? '');
        $skillId = (string) ($event['skill_id'] ?? '');
        $versionId = $event['version_id'] ? (string) $event['version_id'] : null;
        if ($type === 'version_revoked' && $versionId) {
            $row = SkillCatalogVersion::query()->where('version_id', $versionId)->first();
            if ($row) {
                $row->status = 'revoked';
                $row->revoked_at = Carbon::now();
                $row->save();
            }
            return;
        }
        if ($type !== 'version_published' || !$versionId) {
            return;
        }
        if (SkillCatalogVersion::query()->where('version_id', $versionId)->exists()) {
            return;
        }
        $ticket = $this->downloadTicket($versionId, $httpPost);
        $zipPath = $this->fetchZip((string) $ticket['url'], $httpGet);
        try {
            $scan = $this->scanner->scan($zipPath);
            if (!$scan['ok'] || $scan['sha256'] !== ($ticket['sha256'] ?? null)) {
                throw new \RuntimeException($scan['error'] ?: 'digest_mismatch');
            }
            $payload = SkillCanonical::payload([
                'key_id' => (string) ($ticket['key_id'] ?? $event['payload']['key_id'] ?? ''),
                'manifest_schema_version' => 1,
                'published_at' => (string) ($event['payload']['published_at'] ?? gmdate('c')),
                'sha256' => $scan['sha256'],
                'signature_algorithm' => 'ed25519',
                'skill_id' => $scan['manifest']['skill_id'],
                'version' => $scan['manifest']['version'],
                'version_id' => $versionId,
            ]);
            $signature = (string) ($ticket['signature'] ?? '');
            if ($signature !== '' && !$this->signatures->verify($payload, $signature, (string) ($ticket['key_id'] ?? ''))) {
                throw new \RuntimeException('signature_invalid');
            }
            $dir = $this->storageRoot . DIRECTORY_SEPARATOR . $skillId;
            if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
                throw new \RuntimeException('package_unsafe');
            }
            $dest = $dir . DIRECTORY_SEPARATOR . $versionId . '.zip';
            if (!copy($zipPath, $dest)) {
                throw new \RuntimeException('package_unsafe');
            }
            SkillCatalogSkill::query()->updateOrCreate(
                ['skill_id' => $skillId],
                [
                    'slug' => $scan['manifest']['slug'],
                    'name' => $scan['manifest']['name'],
                    'status' => 'active',
                ]
            );
            $manifest = $scan['manifest'];
            if (!empty($event['payload']['published_at'])) {
                $manifest['signed_published_at'] = $event['payload']['published_at'];
            }
            SkillCatalogVersion::query()->create([
                'version_id' => $versionId,
                'skill_id' => $skillId,
                'version' => $scan['manifest']['version'],
                'status' => 'published',
                'sha256' => $scan['sha256'],
                'package_path' => $dest,
                'signature' => $ticket['signature'] ?? null,
                'key_id' => $ticket['key_id'] ?? null,
                'manifest_json' => $manifest,
                'permissions_json' => $scan['manifest']['permissions'],
                'published_at' => isset($event['payload']['published_at'])
                    ? Carbon::parse((string) $event['payload']['published_at'])
                    : Carbon::now(),
            ]);
            unset($payload);
        } finally {
            @unlink($zipPath);
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function fetchEvents(int $after, ?callable $httpGet): array
    {
        $url = $this->baseUrl . '/api/skills/v1/events?after=' . $after . '&limit=100';
        if ($httpGet) {
            return $httpGet($url, $this->syncToken);
        }
        $res = Http::withToken($this->syncToken)->timeout(20)->get($url);
        if (!$res->ok()) {
            throw new \RuntimeException('registry_unavailable');
        }
        return $res->json();
    }

    /**
     * @return array<string, mixed>
     */
    private function downloadTicket(string $versionId, ?callable $httpPost): array
    {
        $url = $this->baseUrl . '/api/skills/v1/versions/' . $versionId . '/download-ticket';
        if ($httpPost) {
            return $httpPost($url, $this->syncToken);
        }
        $res = Http::withToken($this->syncToken)->timeout(20)->post($url);
        if (!$res->ok()) {
            throw new \RuntimeException((string) ($res->json('error') ?: 'version_not_published'));
        }
        return $res->json();
    }

    private function fetchZip(string $url, ?callable $httpGet): string
    {
        $tmp = tempnam(sys_get_temp_dir(), 'skillcat');
        if ($httpGet) {
            $body = $httpGet($url, '');
            if (is_array($body)) {
                throw new \RuntimeException('package_unsafe');
            }
            file_put_contents($tmp, $body);
            return $tmp;
        }
        $res = Http::timeout(60)->get($url);
        if (!$res->ok()) {
            throw new \RuntimeException('package_unsafe');
        }
        file_put_contents($tmp, $res->body());
        return $tmp;
    }
}
