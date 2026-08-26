<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class AppRequestContext
{
    public function handle(Request $request, Closure $next)
    {
        $requestId = trim((string) $request->header('X-Request-Id', ''));
        if ($requestId === '' || !preg_match('/^[A-Za-z0-9._:-]{1,100}$/', $requestId)) {
            $requestId = (string) Str::uuid();
        }

        $request->attributes->set('request_id', $requestId);
        $response = $next($request);
        $response->headers->set('X-Request-Id', $requestId);

        return $response;
    }
}
