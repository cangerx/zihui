<?php

namespace Tests\Unit;

use App\Http\Middleware\CacheTolerantThrottleRequests;
use PHPUnit\Framework\TestCase;
use RuntimeException;

class CacheTolerantThrottleRequestsTest extends TestCase
{
    public function test_lockable_file_error_is_cache_infrastructure_failure(): void
    {
        $this->assertTrue(CacheTolerantThrottleRequests::isCacheInfrastructureFailure(
            new RuntimeException('Unable to create lockable file: /tmp/cache/data/ab/cd/abcd')
        ));
        $this->assertFalse(CacheTolerantThrottleRequests::isCacheInfrastructureFailure(
            new RuntimeException('Too Many Attempts.')
        ));
    }
}
