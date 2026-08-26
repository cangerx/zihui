<?php

namespace App\Http\Middleware;

use App\Services\Build\BuildPackaging;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * T5.3：打包已下线时拒绝外部入口，返回 410。
 * 实现类仍保留，BUILD_PACKAGING_RETIRED=false 可回切。
 */
class RejectRetiredBuildPackaging
{
    public function handle(Request $request, Closure $next): Response
    {
        if (!BuildPackaging::retired()) {
            return $next($request);
        }

        return response()->json(BuildPackaging::gonePayload(), 410);
    }
}
