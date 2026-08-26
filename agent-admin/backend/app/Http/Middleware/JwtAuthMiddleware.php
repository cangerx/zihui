<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Tymon\JWTAuth\Facades\JWTAuth;
use Tymon\JWTAuth\Exceptions\TokenExpiredException;
use Tymon\JWTAuth\Exceptions\TokenInvalidException;
use Tymon\JWTAuth\Exceptions\JWTException;
use App\Support\AppV1Response;

class JwtAuthMiddleware
{
    public function handle(Request $request, Closure $next)
    {
        try {
            $user = JWTAuth::parseToken()->authenticate();
            if (!$user) {
                return AppV1Response::error('unauthenticated', 'User not found', 401);
            }
            if ($user->status !== 'active') {
                return AppV1Response::error('account_disabled', 'Account disabled', 403);
            }
        } catch (TokenExpiredException $e) {
            return AppV1Response::error('unauthenticated', 'Token expired', 401);
        } catch (TokenInvalidException $e) {
            return AppV1Response::error('unauthenticated', 'Token invalid', 401);
        } catch (JWTException $e) {
            return AppV1Response::error('unauthenticated', 'Token not provided', 401);
        }

        return $next($request);
    }
}
