<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class AdminOnly
{
    public function handle(Request $request, Closure $next)
    {
        $user = auth()->user();
        if (!$user || $user->role !== 'admin') {
            return response()->json(['error' => 'Admin access required'], 403);
        }
        return $next($request);
    }
}
