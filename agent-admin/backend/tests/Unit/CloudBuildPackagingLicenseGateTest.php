<?php

namespace Tests\Unit;

use App\Models\CloudBuildJob;
use App\Services\CloudBuild\CloudBuildLocalDispatchService;
use App\Services\CloudBuild\PackagingLicense;
use Tests\Support\FakeCloudBuildGitHubGateway;

class CloudBuildPackagingLicenseGateTest extends CloudBuildExecutionTestCase
{
    public function test_request_rejected_without_windows_license(): void
    {
        PackagingLicense::fake([
            'can_use_github_packaging' => false,
            'can_use_mac_packaging' => false,
        ]);
        $resp = $this->localBackend()->requestBuild('DemoApp', 'win', 'https://admin.example.test/icon.png');
        $this->assertSame(403, $resp['_status']);
        $this->assertSame(PackagingLicense::ERR_NOT_LICENSED, $resp['error']);
        $this->assertSame(0, CloudBuildJob::query()->count());
    }

    public function test_mac_rejected_without_mac_license(): void
    {
        PackagingLicense::fake([
            'can_use_github_packaging' => true,
            'can_use_mac_packaging' => false,
        ]);
        $win = $this->localBackend()->requestBuild('DemoApp', 'win', 'https://admin.example.test/icon.png');
        $this->assertSame(200, $win['_status']);
        $mac = $this->localBackend()->requestBuild('DemoApp', 'mac', 'https://admin.example.test/icon.png');
        $this->assertSame(403, $mac['_status']);
        $this->assertSame(PackagingLicense::ERR_MAC_NOT_LICENSED, $mac['error']);
        $this->assertSame(1, CloudBuildJob::query()->count());
    }

    public function test_dispatch_skipped_without_windows_license(): void
    {
        PackagingLicense::fake([
            'can_use_github_packaging' => true,
            'can_use_mac_packaging' => true,
        ]);
        $this->seedClient('self');
        $github = new FakeCloudBuildGitHubGateway();
        $github->configured = false;
        $backend = $this->localBackend($github);
        $queued = $backend->requestBuild('DemoApp', 'win', 'https://admin.example.test/icon.png');
        $this->assertSame(200, $queued['_status']);

        PackagingLicense::fake([
            'can_use_github_packaging' => false,
            'can_use_mac_packaging' => false,
        ]);
        $github->configured = true;
        $dispatch = new CloudBuildLocalDispatchService($github, $this->claimer, $this->quota, $this->settings);
        $stats = $dispatch->dispatchPending();
        $this->assertSame(0, $github->dispatchCalls);
        $this->assertSame(0, $stats['dispatched']);
    }

    public function test_check_auth_exposes_packaging_flags(): void
    {
        PackagingLicense::fake([
            'can_use_github_packaging' => false,
            'can_use_mac_packaging' => true,
        ]);
        $auth = $this->localBackend()->checkAuth();
        $this->assertTrue($auth['authorized']);
        $this->assertFalse($auth['can_use_github_packaging']);
        $this->assertFalse($auth['can_use_mac_packaging']);
    }
}
