<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

class PackagingLicenseContractTest extends TestCase
{
    public function test_license_route_is_outside_retired_build_group(): void
    {
        $api = file_get_contents(dirname(__DIR__, 2) . '/routes/api.php');
        $this->assertStringContainsString("get('license/site'", $api);
        $this->assertStringContainsString('SiteLicenseController', $api);

        $license = file_get_contents(dirname(__DIR__, 2) . '/app/Http/Controllers/License/SiteLicenseController.php');
        $this->assertStringContainsString('mall_authorizations', $license);
        $this->assertStringContainsString('can_use_ewei_shop', $license);
        $this->assertStringContainsString("prefix('self-serve/packaging')", $api);

        $buildBlock = [];
        if (preg_match("/Route::prefix\\('build'\\)->middleware\\('build_packaging'\\)->group\\(function \\(\\) \\{(.*?)\\n\\}\\);/s", $api, $m)) {
            $buildBlock = [$m[1]];
        }
        $this->assertNotEmpty($buildBlock);
        $this->assertStringNotContainsString('license/site', $buildBlock[0]);
        $this->assertStringNotContainsString('self-serve/packaging', $buildBlock[0]);
    }

    public function test_admin_packaging_routes_exist(): void
    {
        $admin = file_get_contents(dirname(__DIR__, 2) . '/routes/admin.php');
        $this->assertStringContainsString('set-packaging-auth', $admin);
        $this->assertStringContainsString('settings/packaging-license', $admin);
        $this->assertStringContainsString('packaging-license-orders', $admin);
    }

    public function test_migrations_add_flags_and_orders_table(): void
    {
        $flag = file_get_contents(dirname(__DIR__, 2) . '/database/migrations/2026_08_23_000001_add_packaging_license_flags_to_authorized_clients.php');
        $this->assertStringContainsString('can_use_github_packaging', $flag);
        $this->assertStringContainsString('can_use_mac_packaging', $flag);
        $this->assertStringContainsString('hasColumn', $flag);

        $orders = file_get_contents(dirname(__DIR__, 2) . '/database/migrations/2026_08_23_000002_create_packaging_license_orders.php');
        $this->assertStringContainsString('packaging_license_orders', $orders);
        $this->assertStringContainsString('hasTable', $orders);
    }

    public function test_published_migrations_untouched(): void
    {
        $this->assertFileExists(dirname(__DIR__, 2) . '/database/migrations/2026_06_20_000001_add_can_use_ewei_shop_to_authorized_clients.php');
        $legacy = file_get_contents(dirname(__DIR__, 2) . '/database/migrations/2026_06_20_000001_add_can_use_ewei_shop_to_authorized_clients.php');
        $this->assertStringNotContainsString('can_use_github_packaging', $legacy);
    }
}
