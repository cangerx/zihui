<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * 共享库：审核员鉴权。
 *
 * 必须在 domain_binding 之后挂载（依赖其注入的 authorized_client）。
 *
 * 用法：Route::middleware(['domain_binding', 'hub_reviewer'])->group(...)
 *
 * 拒绝条件：authorized_client 缺失（域名校验未先通过）/ is_hub_reviewer != 1。
 */
class HubReviewerOnly
{
    public function handle(Request $request, Closure $next): Response
    {
        $client = $request->attributes->get('authorized_client');

        if (!$client) {
            return response()->json([
                'error' => 'domain_binding_required',
                'message' => 'hub_reviewer 中间件必须在 domain_binding 之后使用',
            ], 500);
        }

        if (empty($client->is_hub_reviewer)) {
            return response()->json([
                'error' => 'not_a_hub_reviewer',
                'message' => '当前云控端站点未被任命为共享库审核员',
            ], 403);
        }

        return $next($request);
    }
}
