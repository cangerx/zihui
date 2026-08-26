<?php

namespace App\Http\Controllers;

use App\Models\SystemSetting;
use App\Services\CloudBuild\EweiShopAuthorization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * 「店铺商品图」独立功能管理（云控端后台）。
 *
 * 仅负责一级授权态的查询与手动刷新（按商城）：
 *  - 一级 = 本云控端实例是否被授权管理端(agent-build)开放某商城（EweiShopAuthorization 按 mall_key 探测）。
 *  - 二级 per-user 权限走通用 PermissionController（policy_key=allow_{mall}_shop）。
 *  - 商城显示名等基础设置走通用 SettingController（system_settings: {mall}_shop_mall_name）。
 */
class EweiShopController extends Controller
{
    /**
     * GET /admin/ewei-shop/authorization
     * 返回本站各商城一级授权态；独立页据此按商城决定显示「管理界面」还是「请联系服务商开通」。
     *
     * 响应：
     *   {
     *     "authorized": bool,                       // 旧字段（= ewei 授权态），兼容旧前端
     *     "malls": { "ewei": bool, "dianda": bool }, // 新增：按商城授权 map
     *     "platform_labels": { "ewei": "eweishop", "dianda": "点大商城" } // 平台真名（后台展示）
     *   }
     */
    public function authorization(): JsonResponse
    {
        $map = EweiShopAuthorization::authorizations();

        return response()->json([
            'authorized' => (bool) ($map[EweiShopAuthorization::DEFAULT_MALL] ?? false),
            'malls' => $map,
            'platform_labels' => SystemSetting::SHOP_PLATFORM_LABELS,
        ]);
    }

    /**
     * POST /admin/ewei-shop/refresh-auth
     * 清掉全部商城授权态缓存并立即回源探测授权管理端，返回最新结果（按商城）。
     * 用于授权管理端刚开通后，管理员手动「立即刷新」而不必等缓存（FRESH/PENDING）过期。
     *
     * 入参（可选）：mall —— 仅用于回选某商城对应的 authorized 字段；刷新始终是整张 map 回源。
     */
    public function refreshAuth(Request $request): JsonResponse
    {
        EweiShopAuthorization::forget();
        $map = EweiShopAuthorization::refresh();

        // 兼容旧前端的单值 authorized：默认取 ewei；若显式传 mall 则取对应商城
        $mall = (string) $request->input('mall', EweiShopAuthorization::DEFAULT_MALL);
        if (!in_array($mall, EweiShopAuthorization::MALL_KEYS, true)) {
            $mall = EweiShopAuthorization::DEFAULT_MALL;
        }

        return response()->json([
            'authorized' => (bool) ($map[$mall] ?? false),
            'malls' => $map,
            'platform_labels' => SystemSetting::SHOP_PLATFORM_LABELS,
        ]);
    }
}
