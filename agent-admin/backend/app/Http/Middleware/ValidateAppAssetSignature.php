<?php

namespace App\Http\Middleware;

use App\Support\AppV1Response;
use Closure;
use Illuminate\Http\Request;

class ValidateAppAssetSignature
{
    public function handle(Request $request, Closure $next)
    {
        if (!$this->hasCanonicalAssetPath($request)) {
            return AppV1Response::error('signature_invalid', '上传签名无效或已过期', 401);
        }
        if (!$request->hasValidSignature()) {
            $expired = $request->query('expires') !== null && (int) $request->query('expires') < time();
            return AppV1Response::error($expired ? 'signature_expired' : 'signature_invalid', '上传签名无效或已过期', 401);
        }

        $signedUser = (string) $request->query('user', '');
        $authenticatedUser = $request->user();
        if (!$authenticatedUser || !hash_equals((string) $authenticatedUser->getAuthIdentifier(), $signedUser)) {
            return AppV1Response::error('asset_not_found', 'Asset not found', 404);
        }

        return $next($request);
    }

    private function hasCanonicalAssetPath(Request $request): bool
    {
        $id = (string) $request->route('id', '');
        if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/D', $id)) {
            return false;
        }

        $route = $request->route();
        $template = is_object($route) && method_exists($route, 'uri') ? (string) $route->uri() : '';
        if ($template === '' || !str_contains($template, '{id}')) return false;

        $rawPath = parse_url((string) $request->server('REQUEST_URI', ''), PHP_URL_PATH);
        if (!is_string($rawPath)) return false;

        $expectedPath = rtrim($request->getBaseUrl(), '/') . '/'
            . ltrim(str_replace('{id}', $id, $template), '/');

        return hash_equals($expectedPath, $rawPath);
    }
}
