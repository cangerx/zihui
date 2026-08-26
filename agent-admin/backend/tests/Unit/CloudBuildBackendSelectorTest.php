<?php

namespace Tests\Unit;

use App\Services\CloudBuild\CloudBuildBackendSelector;

class CloudBuildBackendSelectorTest extends CloudBuildExecutionTestCase
{
    public function test_auto_uses_local_in_testing_and_remote_in_production(): void
    {
        $this->assertSame('local', (new CloudBuildBackendSelector('auto', 'testing'))->mode());
        $this->assertSame('local', (new CloudBuildBackendSelector('auto', 'local'))->mode());
        $this->assertSame('remote', (new CloudBuildBackendSelector('auto', 'production'))->mode());
        $this->assertTrue((new CloudBuildBackendSelector('auto', 'testing'))->usesLocal());
        $this->assertFalse((new CloudBuildBackendSelector('auto', 'production'))->usesLocal());
    }

    public function test_explicit_env_overrides_auto(): void
    {
        $this->assertSame('local', (new CloudBuildBackendSelector('local', 'production'))->mode());
        $this->assertSame('remote', (new CloudBuildBackendSelector('remote', 'testing'))->mode());
    }

    public function test_cutover_override_applies_only_when_backend_is_auto(): void
    {
        $path = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'cb-sel-' . bin2hex(random_bytes(4)) . '.json';
        $store = new \App\Services\CloudBuild\CloudBuildCutoverStore($path);
        $store->patch(['backend_override' => 'local']);

        $this->assertSame('local', (new CloudBuildBackendSelector('auto', 'production', $store))->mode());
        $this->assertSame('remote', (new CloudBuildBackendSelector('remote', 'production', $store))->mode());
        @unlink($path);
    }
}
