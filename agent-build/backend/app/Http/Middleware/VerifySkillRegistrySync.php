<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class VerifySkillRegistrySync
{
    public function handle(Request $request, Closure $next)
    {
        $expected = (string) config('skill_registry.sync_token', '');
        $got = (string) $request->bearerToken();
        if ($expected === '' || $got === '' || !hash_equals($expected, $got)) {
            return response()->json(['error' => 'skill_not_available'], 401);
        }
        return $next($request);
    }
}
