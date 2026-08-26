<?php

namespace Tests\Unit;

use App\Models\SkillCatalogSkill;
use App\Models\SkillCatalogSyncState;
use App\Models\SkillCatalogTenantPolicy;
use App\Models\SkillCatalogVersion;
use App\Services\SkillCatalog\SkillCatalogSyncService;
use App\Services\SkillCatalog\SkillPackageScanner;
use App\Services\SkillCatalog\SkillSignatureService;
use PHPUnit\Framework\TestCase;
use Tests\Support\SkillCatalogHarness;
use ZipArchive;

class SkillCatalogSyncServiceTest extends TestCase
{
    private string $storage;
    private string $zipPath;
    private string $sha256;
    private array $manifest;
    private SkillSignatureService $signatures;
    private array $signed;

    protected function setUp(): void
    {
        parent::setUp();
        SkillCatalogHarness::boot();
        $this->storage = sys_get_temp_dir() . '/skill-cat-sync-' . bin2hex(random_bytes(3));
        mkdir($this->storage, 0750, true);

        $kp = sodium_crypto_sign_keypair();
        $this->signatures = new SkillSignatureService(
            'registry-test',
            sodium_crypto_sign_secretkey($kp),
            sodium_crypto_sign_publickey($kp)
        );

        $this->manifest = [
            'schema_version' => 1,
            'skill_id' => '11111111-1111-4111-8111-111111111111',
            'version_id' => '22222222-2222-4222-8222-222222222222',
            'slug' => 'demo-skill',
            'name' => 'Demo',
            'version' => '1.2.3',
            'entrypoint' => 'SKILL.md',
            'files' => ['SKILL.md', 'skill.json'],
            'permissions' => [
                'filesystem' => 'none',
                'network' => ['domains' => []],
                'commands' => [],
                'mcp_servers' => [],
                'external_programs' => [],
            ],
            'minimum_client_version' => '1.2.0',
        ];
        $this->zipPath = $this->storage . '/ok.zip';
        $zip = new ZipArchive();
        $zip->open($this->zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE);
        $zip->addFromString('skill.json', json_encode($this->manifest, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        $zip->addFromString('SKILL.md', "# Demo\n");
        $zip->close();
        $scan = (new SkillPackageScanner())->scan($this->zipPath);
        $this->assertTrue($scan['ok']);
        $this->sha256 = $scan['sha256'];
        $this->signed = $this->signatures->sign([
            'skill_id' => $this->manifest['skill_id'],
            'version_id' => $this->manifest['version_id'],
            'version' => $this->manifest['version'],
            'sha256' => $this->sha256,
            'published_at' => '2026-08-22T08:00:00+00:00',
        ]);
    }

    private function service(): SkillCatalogSyncService
    {
        return new SkillCatalogSyncService(
            new SkillPackageScanner(),
            $this->signatures,
            'https://registry.example.test',
            'sync-token',
            $this->storage . '/mirror'
        );
    }

    private function publishedEvent(int $cursor): array
    {
        return [
            'cursor' => $cursor,
            'event_type' => 'version_published',
            'skill_id' => $this->manifest['skill_id'],
            'version_id' => $this->manifest['version_id'],
            'payload' => [
                'version' => $this->manifest['version'],
                'sha256' => $this->sha256,
                'key_id' => 'registry-test',
                'published_at' => '2026-08-22T08:00:00+00:00',
            ],
        ];
    }

    private function httpGet(string $zipBytes): callable
    {
        return function (string $url) use ($zipBytes) {
            if (str_contains($url, '/events')) {
                return ['data' => [$this->publishedEvent(1)], 'next_cursor' => 1, 'has_more' => false];
            }
            return $zipBytes;
        };
    }

    private function httpPost(): callable
    {
        return function () {
            return [
                'url' => 'https://registry.example.test/api/skills/v1/download/ticket',
                'expires_at' => gmdate('c', time() + 60),
                'sha256' => $this->sha256,
                'signature' => $this->signed['signature'],
                'signature_algorithm' => 'ed25519',
                'key_id' => 'registry-test',
            ];
        };
    }

    public function test_empty_batch_does_not_wipe_catalog(): void
    {
        SkillCatalogSkill::query()->create([
            'skill_id' => $this->manifest['skill_id'],
            'slug' => 'demo-skill',
            'name' => 'Demo',
            'status' => 'active',
        ]);
        SkillCatalogSyncState::query()->create(['cursor' => 4]);
        $result = $this->service()->sync(
            fn () => ['data' => [], 'next_cursor' => 4, 'has_more' => false],
            fn () => []
        );
        $this->assertTrue($result['ok']);
        $this->assertSame(0, $result['applied']);
        $this->assertSame(1, SkillCatalogSkill::query()->count());
        $this->assertSame(4, (int) SkillCatalogSyncState::query()->value('cursor'));
    }

    public function test_publish_then_duplicate_does_not_recreate_version(): void
    {
        $zip = file_get_contents($this->zipPath);
        $svc = $this->service();
        $first = $svc->sync($this->httpGet($zip), $this->httpPost());
        $this->assertTrue($first['ok']);
        $this->assertSame(1, SkillCatalogVersion::query()->count());
        $replay = [
            'cursor' => 2,
            'event_type' => 'version_published',
            'skill_id' => $this->manifest['skill_id'],
            'version_id' => $this->manifest['version_id'],
            'payload' => [
                'version' => $this->manifest['version'],
                'sha256' => $this->sha256,
                'key_id' => 'registry-test',
                'published_at' => '2026-08-22T08:00:00+00:00',
            ],
        ];
        $second = $svc->sync(
            fn () => ['data' => [$replay], 'next_cursor' => 2, 'has_more' => false],
            $this->httpPost()
        );
        $this->assertTrue($second['ok'], (string) $second['error']);
        $this->assertSame(1, SkillCatalogVersion::query()->count());
        $this->assertSame(2, (int) SkillCatalogSyncState::query()->value('cursor'));
    }

    public function test_cursor_gap_does_not_advance_or_wipe(): void
    {
        SkillCatalogSkill::query()->create([
            'skill_id' => $this->manifest['skill_id'],
            'slug' => 'demo-skill',
            'name' => 'Demo',
            'status' => 'active',
        ]);
        SkillCatalogSyncState::query()->create(['cursor' => 0]);
        $result = $this->service()->sync(
            fn () => ['data' => [$this->publishedEvent(3)], 'next_cursor' => 3, 'has_more' => false],
            $this->httpPost()
        );
        $this->assertFalse($result['ok']);
        $this->assertSame('cursor_gap', $result['error']);
        $this->assertSame(0, (int) SkillCatalogSyncState::query()->value('cursor'));
        $this->assertSame(1, SkillCatalogSkill::query()->count());
        $this->assertSame(0, SkillCatalogVersion::query()->count());
    }

    public function test_tampered_package_rejected_and_catalog_kept(): void
    {
        SkillCatalogSkill::query()->create([
            'skill_id' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'slug' => 'kept',
            'name' => 'Kept',
            'status' => 'active',
        ]);
        $bad = $this->storage . '/bad.zip';
        $zip = new ZipArchive();
        $zip->open($bad, ZipArchive::CREATE | ZipArchive::OVERWRITE);
        $zip->addFromString('skill.json', json_encode($this->manifest, JSON_UNESCAPED_SLASHES));
        $zip->addFromString('SKILL.md', "# tampered\n");
        $zip->close();
        $result = $this->service()->sync(
            $this->httpGet(file_get_contents($bad)),
            $this->httpPost()
        );
        $this->assertFalse($result['ok']);
        $this->assertSame(0, SkillCatalogVersion::query()->count());
        $this->assertTrue(SkillCatalogSkill::query()->where('slug', 'kept')->exists());
        $this->assertSame(0, (int) (SkillCatalogSyncState::query()->value('cursor') ?: 0));
    }

    public function test_revoke_stops_distribution_but_keeps_package(): void
    {
        $zip = file_get_contents($this->zipPath);
        $svc = $this->service();
        $this->assertTrue($svc->sync($this->httpGet($zip), $this->httpPost())['ok']);
        $path = SkillCatalogVersion::query()->first()->package_path;
        $this->assertFileExists($path);

        $revoke = [
            'cursor' => 2,
            'event_type' => 'version_revoked',
            'skill_id' => $this->manifest['skill_id'],
            'version_id' => $this->manifest['version_id'],
            'payload' => ['sha256' => $this->sha256],
        ];
        $result = $svc->sync(
            fn () => ['data' => [$revoke], 'next_cursor' => 2, 'has_more' => false],
            $this->httpPost()
        );
        $this->assertTrue($result['ok']);
        $row = SkillCatalogVersion::query()->first();
        $this->assertSame('revoked', $row->status);
        $this->assertSame($path, $row->package_path);
        $this->assertFileExists($path);
        $this->assertSame(2, (int) SkillCatalogSyncState::query()->value('cursor'));
    }

    public function test_upsert_skill_does_not_override_tenant_listed(): void
    {
        SkillCatalogSkill::query()->create([
            'skill_id' => $this->manifest['skill_id'],
            'slug' => 'old-slug',
            'name' => 'Old',
            'status' => 'active',
            'category' => 'ops',
            'recommended' => true,
        ]);
        SkillCatalogTenantPolicy::query()->create([
            'tenant_id' => 9,
            'skill_id' => $this->manifest['skill_id'],
            'listed' => false,
        ]);
        $zip = file_get_contents($this->zipPath);
        $this->assertTrue($this->service()->sync($this->httpGet($zip), $this->httpPost())['ok']);
        $skill = SkillCatalogSkill::query()->where('skill_id', $this->manifest['skill_id'])->first();
        $this->assertSame('demo-skill', $skill->slug);
        $this->assertSame('ops', $skill->category);
        $this->assertTrue((bool) $skill->recommended);
        $policy = SkillCatalogTenantPolicy::query()->where('tenant_id', 9)->first();
        $this->assertFalse((bool) $policy->listed);
    }
}
