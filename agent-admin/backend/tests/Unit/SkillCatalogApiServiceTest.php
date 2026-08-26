<?php

namespace Tests\Unit;

use App\Models\SkillCatalogSkill;
use App\Models\SkillCatalogVersion;
use App\Services\SkillCatalog\SkillCatalogDownloadTicketService;
use App\Services\SkillCatalog\SkillCatalogService;
use PHPUnit\Framework\TestCase;
use Tests\Support\SkillCatalogHarness;

class SkillCatalogApiServiceTest extends TestCase
{
    private SkillCatalogService $catalog;
    private string $zip;

    protected function setUp(): void
    {
        parent::setUp();
        SkillCatalogHarness::boot();
        $tickets = new SkillCatalogDownloadTicketService('catalog-ticket-secret', 60, '/api/client/skills/download');
        $this->catalog = new SkillCatalogService($tickets);
        $dir = sys_get_temp_dir() . '/skill-cat-api-' . bin2hex(random_bytes(3));
        mkdir($dir, 0750, true);
        $this->zip = $dir . '/pkg.zip';
        file_put_contents($this->zip, 'zip-bytes');

        SkillCatalogSkill::query()->create([
            'skill_id' => '11111111-1111-4111-8111-111111111111',
            'slug' => 'demo-skill',
            'name' => 'Demo',
            'status' => 'active',
            'category' => 'ops',
            'recommended' => true,
        ]);
        SkillCatalogVersion::query()->create([
            'version_id' => '22222222-2222-4222-8222-222222222222',
            'skill_id' => '11111111-1111-4111-8111-111111111111',
            'version' => '1.2.3',
            'status' => 'published',
            'sha256' => str_repeat('a', 64),
            'package_path' => $this->zip,
            'signature' => 'sig',
            'key_id' => 'registry-test',
            'permissions_json' => ['filesystem' => 'none'],
            'manifest_json' => ['description' => 'Demo skill for operators'],
        ]);
    }

    public function test_client_catalog_hides_unlisted_and_revoked(): void
    {
        $visible = $this->catalog->clientCatalog(7);
        $this->assertCount(1, $visible['data']);
        $this->assertSame('Demo skill for operators', $visible['data'][0]['description']);
        $this->catalog->setListed('11111111-1111-4111-8111-111111111111', 7, false);
        $hidden = $this->catalog->clientCatalog(7);
        $this->assertCount(0, $hidden['data']);
        $other = $this->catalog->clientCatalog(8);
        $this->assertCount(1, $other['data']);

        $this->catalog->setListed('11111111-1111-4111-8111-111111111111', 7, true);
        SkillCatalogVersion::query()->where('version_id', '22222222-2222-4222-8222-222222222222')
            ->update(['status' => 'revoked']);
        $revoked = $this->catalog->clientCatalog(7);
        $this->assertCount(0, $revoked['data']);
        $ticket = $this->catalog->clientDownloadTicket('22222222-2222-4222-8222-222222222222', 7);
        $this->assertSame('version_revoked', $ticket['error']);
    }

    public function test_download_ticket_and_digest_mismatch(): void
    {
        $issued = $this->catalog->clientDownloadTicket('22222222-2222-4222-8222-222222222222', 1);
        $this->assertSame(200, $issued['status']);
        $this->assertArrayHasKey('url', $issued['body']);
        $token = basename($issued['body']['url']);
        $ok = $this->catalog->resolveDownload($token);
        $this->assertSame(200, $ok['status']);

        $expired = $this->catalog->resolveDownload('not-a-ticket');
        $this->assertSame('download_ticket_expired', $expired['error']);

        $this->catalog->setListed('11111111-1111-4111-8111-111111111111', 0, false);
        $disabled = $this->catalog->clientDownloadTicket('22222222-2222-4222-8222-222222222222', 1);
        $this->assertSame('tenant_skill_disabled', $disabled['error']);
    }

    public function test_admin_routes_exist_in_api_file(): void
    {
        $api = file_get_contents(dirname(__DIR__, 2) . '/routes/api.php');
        $this->assertStringContainsString("Route::get('/catalog'", $api);
        $this->assertStringContainsString('versions/{versionId}/download-ticket', $api);
        $this->assertStringContainsString('SkillCatalogAdminController', $api);
        $this->assertStringContainsString('SkillCatalogClientController', $api);
        $kernel = file_get_contents(dirname(__DIR__, 2) . '/app/Console/Kernel.php');
        $this->assertStringContainsString('skill-catalog:sync', $kernel);
    }

    public function test_global_unlist_does_not_delete_skill_row(): void
    {
        $this->catalog->updateSkill('11111111-1111-4111-8111-111111111111', [
            'listed' => false,
            'category' => 'security',
            'recommended' => false,
        ], 0);
        $this->assertSame(1, SkillCatalogSkill::query()->count());
        $this->assertSame('security', SkillCatalogSkill::query()->value('category'));
        $this->assertCount(0, $this->catalog->clientCatalog(1)['data']);
    }
}
