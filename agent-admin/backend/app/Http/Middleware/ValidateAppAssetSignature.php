<?php

namespace App\Http\Middleware;

use App\Support\AppV1Response;
use Closure;
use Illuminate\Http\Request;

class ValidateAppAssetSignature
{
    public function handle(Request $request, Closure $next)
    {
        if (!$request->hasValidSignature()) {
            $expired = $request->query('expires') !== null && (int) $request->query('expires') < time();
            return AppV1Response::error($expired ? 'signature_expired' : 'signature_invalid', '上传签名无效或已过期', 401);
        }
        return $next($request);
    }
}
