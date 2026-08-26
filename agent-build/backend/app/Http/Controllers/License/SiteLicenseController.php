<?php

namespace App\Http\Controllers\License;

use App\Http\Controllers\Controller;
use App\Services\Mall\MallAuthorizationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * 云控探测站点许可（打包两档 + 店铺商品图商城授权）。
 * 不走 /api/build/*，退休中间件不影响本接口。
 */
class SiteLicenseController extends Controller
{
    public function show(Request $request, MallAuthorizationService $mallAuth): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');
        if (!is_object($client)) {
            return response()->json(['error' => 'domain_not_authorized'], 403);
        }

        $mallAuthorizations = $mallAuth->getAuthorizations($client);

        return response()->json([
            'authorized' => true,
            'domain' => (string) ($client->domain ?? ''),
            'status' => (string) ($client->status ?? ''),
            'expires_at' => $client->expires_at ?? null,
            'can_use_github_packaging' => (bool) ($client->can_use_github_packaging ?? false),
            'can_use_mac_packaging' => (bool) ($client->can_use_mac_packaging ?? false),
            'can_use_ewei_shop' => (bool) ($mallAuthorizations['ewei'] ?? false),
            'mall_authorizations' => $mallAuthorizations,
        ]);
    }
}
