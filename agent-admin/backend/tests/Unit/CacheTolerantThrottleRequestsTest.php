<?php

namespace Tests\Unit;

use App\Http\Middleware\CacheTolerantThrottleRequests;
use Illuminate\Cache\RateLimiter;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Cache\ArrayStore;
use Illuminate\Cache\Repository;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
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

    public function test_named_limiter_keeps_laravel_named_limiter_semantics(): void
    {
        $limiter = new RateLimiter(new Repository(new ArrayStore()));
        $limiter->for('named-test', fn () => Limit::perMinute(2)->by('subject'));
        $middleware = new CacheTolerantThrottleRequests($limiter);
        $request = Request::create('/named-test', 'POST');
        $next = static fn () => new Response('ok', 200);

        $this->assertSame(200, $middleware->handle($request, $next, 'named-test')->getStatusCode());
        $this->assertSame(200, $middleware->handle($request, $next, 'named-test')->getStatusCode());

        $this->expectException(\Illuminate\Http\Exceptions\ThrottleRequestsException::class);
        $middleware->handle($request, $next, 'named-test');
    }
}
