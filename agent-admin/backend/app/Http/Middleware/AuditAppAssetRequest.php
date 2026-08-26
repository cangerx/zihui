<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Throwable;

class AuditAppAssetRequest
{
    public function handle(Request $request, Closure $next)
    {
        $assetIds = $this->assetIds($request);
        $isAssetEndpoint = str_contains($request->path(), '/assets/');
        if (!$isAssetEndpoint && $assetIds === []) {
            return $next($request);
        }

        try {
            $response = $next($request);
        } catch (Throwable $e) {
            $this->write($request, $assetIds, 500, 'unhandled_exception');
            throw $e;
        }

        $errorCode = null;
        if ($response instanceof JsonResponse) {
            $payload = $response->getData(true);
            $errorCode = is_array($payload) ? ($payload['error']['code'] ?? null) : null;
            $responseAssetId = is_array($payload) ? ($payload['data']['id'] ?? null) : null;
            if ($isAssetEndpoint && is_string($responseAssetId) && $responseAssetId !== '') {
                $assetIds[] = strtolower($responseAssetId);
                $assetIds = array_slice(array_values(array_unique($assetIds)), 0, 4);
            }
        }
        $this->write($request, $assetIds, $response->getStatusCode(), is_string($errorCode) ? $errorCode : null);

        return $response;
    }

    private function assetIds(Request $request): array
    {
        $ids = [];
        foreach ((array) $request->input('asset_ids', []) as $candidate) {
            if (!is_string($candidate) || $candidate === '') continue;
            $candidate = strtolower(substr($candidate, 0, 200));
            if (!in_array($candidate, $ids, true)) $ids[] = $candidate;
            if (count($ids) === 4) break;
        }

        $routeId = $request->route('id');
        if (count($ids) < 4 && is_string($routeId) && $routeId !== '') {
            $routeId = strtolower(substr($routeId, 0, 200));
            if (!in_array($routeId, $ids, true)) $ids[] = $routeId;
        }

        return $ids;
    }

    private function write(Request $request, array $assetIds, int $status, ?string $errorCode): void
    {
        try {
            $channel = preg_replace('/[^\x20-\x7E]/', '', (string) $request->header('X-Channel', '')) ?: '';
            $channel = substr($channel, 0, 32);

            Log::info('app_v1.asset_request', [
                'request_id' => (string) $request->attributes->get('request_id', ''),
                'user_id' => $request->user() ? (int) $request->user()->getAuthIdentifier() : null,
                'channel' => $channel,
                'ip' => (string) $request->ip(),
                'method' => $request->method(),
                'route' => (string) optional($request->route())->getName(),
                'route_template' => '/' . ltrim((string) optional($request->route())->uri(), '/'),
                'asset_id_summaries' => array_map(
                    static fn (string $id) => substr(hash('sha256', $id), 0, 12),
                    $assetIds
                ),
                'status' => $status,
                'error_code' => $errorCode,
            ]);
        } catch (Throwable $ignored) {
            // Audit transport failures must not mutate the API response after the action completed.
        }
    }
}
