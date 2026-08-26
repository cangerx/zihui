<?php

namespace Tests\Unit;

use App\Services\CloudBuild\CloudBuildFrontendStatusProjector;
use App\Services\CloudBuild\CloudBuildPhaseNormalizer;

class CloudBuildFrontendApiContractTest extends CloudBuildExecutionTestCase
{
    public function test_ledger_fixture_projects_to_existing_frontend_statuses(): void
    {
        $path = dirname(__DIR__, 2) . '/../docs/contracts/cloud-build-migration/fixture.json';
        $fixture = json_decode((string) file_get_contents($path), true);
        $this->assertIsArray($fixture);
        $projector = new CloudBuildFrontendStatusProjector();
        $allowed = CloudBuildFrontendStatusProjector::FRONTEND_STATUSES;

        foreach ($fixture['source'] as $row) {
            $phase = CloudBuildPhaseNormalizer::fromSource((string) $row['status'], $row['mirror_status'] ?? null);
            $ui = $projector->fromPhase($phase);
            $this->assertContains($ui, $allowed);
            $this->assertNotSame('artifact_pending', $ui);
            $this->assertNotSame('ready', $ui);
            $this->assertNotSame('legacy_ready_or_unknown', $ui);
        }

        foreach ($fixture['target'] as $row) {
            $ui = $projector->fromPhase((string) $row['phase']);
            $this->assertContains($ui, $allowed);
            $this->assertNotSame('artifact_pending', $ui);
            $this->assertNotSame('ready', $ui);
        }
    }

    public function test_request_and_auth_response_keys_match_old_frontend(): void
    {
        $contractPath = dirname(__DIR__, 2) . '/../docs/contracts/cloud-build-migration/frontend-api.fixture.json';
        $contract = json_decode((string) file_get_contents($contractPath), true);
        $this->assertIsArray($contract);

        $backend = $this->localBackend();
        $auth = $backend->checkAuth();
        foreach ($contract['auth_check_success_keys'] as $key) {
            $this->assertArrayHasKey($key, $auth, "auth-check missing {$key}");
        }

        $request = $backend->requestBuild('ContractApp', 'win', 'https://admin.example.test/icon.png');
        foreach ($contract['request_success_keys'] as $key) {
            $this->assertArrayHasKey($key, $request, "request missing {$key}");
        }
        $this->assertContains($request['status'], CloudBuildFrontendStatusProjector::FRONTEND_STATUSES);
    }
}
