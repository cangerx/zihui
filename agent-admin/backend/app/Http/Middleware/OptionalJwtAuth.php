<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Tymon\JWTAuth\Facades\JWTAuth;

class OptionalJwtAuth
{
    /**
     * 可选 JWT 鉴权：携带有效 token 则登入用户（controller 内 auth()->user() 可取），
     * 未携带 / 无效 / 过期一律放行并降级为匿名（user 为 null）。
     * 用于「公开可浏览、但登录后按身份个性化」的接口，如智能体市场列表。
     */
    public function handle(Request $request, Closure $next)
    {
        try {
            if ($request->bearerToken()) {
                $user = JWTAuth::parseToken()->authenticate();
                if ($user && $user->status === 'active') {
                    auth()->setUser($user);
                }
            }
        } catch (\Throwable $e) {
            // 忽略一切 token 异常，按匿名访问继续
        }

        return $next($request);
    }
}
