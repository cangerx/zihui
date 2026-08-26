<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * 文件缓存目录权限坏掉时，Laravel 默认 throttle 会 500。
 * GitHub 失败回调因此写不进任务，只能等到 stuck_no_run_id。
 */
class CacheTolerantThrottleRequests extends ThrottleRequests
{
    public function handle($request, Closure $next, $maxAttempts = 60, $decayMinutes = 1, $prefix = '')
    {
        try {
            return parent::handle($request, $next, $maxAttempts, $decayMinutes, $prefix);
        } catch (Throwable $e) {
            if (!self::isCacheInfrastructureFailure($e)) {
                throw $e;
            }
            try {
                Log::warning('[Throttle] cache unavailable, allowing request', [
                    'path' => $request instanceof Request ? $request->path() : '',
                    'error' => mb_substr($e->getMessage(), 0, 180),
                ]);
            } catch (Throwable $ignored) {
                // 单测或 log 容器缺失时仍放行
            }
            return $next($request);
        }
    }

    public static function isCacheInfrastructureFailure(Throwable $e): bool
    {
        $msg = $e->getMessage();
        return str_contains($msg, 'Unable to create lockable file')
            || str_contains($msg, 'Permission denied')
            || str_contains($msg, 'Read-only file system');
    }
}
