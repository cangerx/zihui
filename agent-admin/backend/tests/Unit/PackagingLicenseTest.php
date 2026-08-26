<?php

namespace Tests\Unit;

use App\Services\CloudBuild\PackagingLicense;
use PHPUnit\Framework\TestCase;

class PackagingLicenseTest extends TestCase
{
    protected function tearDown(): void
    {
        PackagingLicense::forget();
        parent::tearDown();
    }

    public function test_deny_reason_fail_closed(): void
    {
        PackagingLicense::fake([
            'can_use_github_packaging' => false,
            'can_use_mac_packaging' => false,
        ]);
        $this->assertSame(PackagingLicense::ERR_NOT_LICENSED, PackagingLicense::denyReason('win'));
        $this->assertSame(PackagingLicense::ERR_NOT_LICENSED, PackagingLicense::denyReason('mac'));
        $this->assertFalse(PackagingLicense::canUseGithub());
        $this->assertFalse(PackagingLicense::canUseMac());
    }

    public function test_mac_requires_both_flags(): void
    {
        PackagingLicense::fake([
            'can_use_github_packaging' => true,
            'can_use_mac_packaging' => false,
        ]);
        $this->assertNull(PackagingLicense::denyReason('win'));
        $this->assertSame(PackagingLicense::ERR_MAC_NOT_LICENSED, PackagingLicense::denyReason('mac'));
        $this->assertTrue(PackagingLicense::canUseGithub());
        $this->assertFalse(PackagingLicense::canUseMac());
    }

    public function test_both_flags_open_mac(): void
    {
        PackagingLicense::fake([
            'can_use_github_packaging' => true,
            'can_use_mac_packaging' => true,
        ]);
        $this->assertNull(PackagingLicense::denyReason('win'));
        $this->assertNull(PackagingLicense::denyReason('mac'));
        $this->assertTrue(PackagingLicense::canUseMac());
    }

    public function test_normalize_defaults_false(): void
    {
        $map = PackagingLicense::normalize([]);
        $this->assertFalse($map['can_use_github_packaging']);
        $this->assertFalse($map['can_use_mac_packaging']);
    }

    public function test_github_settings_override_env(): void
    {
        $merged = PackagingLicense::mergeGithubConfig(
            ['token' => 'env-token', 'repo' => 'env/repo', 'ref' => 'main'],
            ['token' => 'stored-token', 'repo' => 'owner/stored']
        );
        $this->assertSame('stored-token', $merged['token']);
        $this->assertSame('owner/stored', $merged['repo']);
        $this->assertSame('main', $merged['ref']);
    }

    public function test_empty_stored_keeps_env(): void
    {
        $merged = PackagingLicense::mergeGithubConfig(
            ['token' => 'env-token', 'repo' => 'env/repo'],
            ['token' => '', 'repo' => '']
        );
        $this->assertSame('env-token', $merged['token']);
        $this->assertSame('env/repo', $merged['repo']);
    }
}
