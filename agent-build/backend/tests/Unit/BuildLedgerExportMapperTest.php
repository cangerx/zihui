<?php

namespace Tests\Unit;

use App\Services\Build\BuildLedgerCanonical;
use App\Services\Build\BuildLedgerExportMapper;
use PHPUnit\Framework\TestCase;

class BuildLedgerExportMapperTest extends TestCase
{
    public function test_maps_request_and_redacts_secrets(): void
    {
        $mapper = new BuildLedgerExportMapper();
        $row = $mapper->mapRequest([
            'build_id' => '00000000-0000-4000-8000-000000000003',
            'client_id' => 'client-a',
            'platform' => 'win',
            'build_mode' => 'normal',
            'status' => 'success',
            'mirror_status' => 'mirroring',
            'dispatch_attempts' => 2,
            'executor_run_id' => 2003,
            'callback_token' => 'should-not-export',
            'mirror_url_primary' => 'https://cdn.example/app.exe',
            'artifact_files' => json_encode([[
                'filename' => 'app.exe',
                'role' => 'primary',
                'size' => 120,
                'sha256' => str_repeat('aa', 32),
                'asset_url' => 'https://api.github.com/assets/9',
            ]]),
        ]);

        $this->assertSame('client-a', $row['client_ref']);
        $this->assertArrayNotHasKey('callback_token', $row);
        $this->assertArrayNotHasKey('mirror_url_primary', $row);
        $this->assertSame('app.exe', $row['artifacts'][0]['filename']);
        $this->assertArrayNotHasKey('asset_url', $row['artifacts'][0]);
        $this->assertSame('artifact_pending', BuildLedgerCanonical::canonicalJob($row, true)['phase']);
    }

    public function test_pack_digest_matches_admin_contract_fixture(): void
    {
        $path = dirname(__DIR__, 3) . '/../agent-admin/docs/contracts/cloud-build-migration/fixture.json';
        $fixture = json_decode((string) file_get_contents($path), true);
        $this->assertIsArray($fixture);
        $digest = BuildLedgerCanonical::digest($fixture['source'], true);
        $this->assertSame('4e93e4f0e827f30669f86bbc90910571bbaef4c80c8e7bddecdb2aa3830add05', $digest);

        $mapper = new BuildLedgerExportMapper();
        $packed = $mapper->pack($fixture['source'], [
            ['client_ref' => 'client-a', 'domain' => 'admin-a.example.test', 'daily_limit' => 10, 'monthly_limit' => 0, 'status' => 'active', 'expires_at' => null, 'maintenance_exempt' => 0],
        ], [], []);
        $this->assertSame(BuildLedgerCanonical::FORMAT, $packed['format']);
        $this->assertSame($digest, $packed['manifest']['canonical_sha256']);
        $this->assertNotSame('', $packed['manifest']['payload_sha256']);
    }

    public function test_map_client_drops_secret_and_phone(): void
    {
        $mapped = (new BuildLedgerExportMapper())->mapClient([
            'client_id' => 'client-a',
            'domain' => 'admin-a.example.test',
            'client_secret' => 'bcrypt-hash',
            'owner_name' => 'Alice',
            'owner_phone' => '13800000000',
            'daily_limit' => 3,
            'status' => 'active',
            'maintenance_exempt' => 1,
        ]);
        $this->assertSame('client-a', $mapped['client_ref']);
        $this->assertArrayNotHasKey('client_secret', $mapped);
        $this->assertArrayNotHasKey('owner_phone', $mapped);
        $this->assertArrayNotHasKey('owner_name', $mapped);
        $this->assertSame(1, $mapped['maintenance_exempt']);
    }
}
