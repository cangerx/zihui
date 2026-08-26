<?php

namespace App\Services\CloudBuild;

use Illuminate\Support\Facades\Cache;

/**
 * 「店铺商品图」功能的一级授权门控（按商城 mall_key 分别判定）。
 *
 * 来源：授权管理端 agent-build 的 GET /api/license/site。
 * /api/build/auth-check 已随打包退休返回 410，不能再当商城授权探测。
 *   - 新字段 mall_authorizations = {"ewei":bool,"dianda":bool}（按商城独立授权，可扩展）。
 *   - 旧字段 can_use_ewei_shop（= ewei 的授权位）仍保留，供 mall_authorizations 缺失时回退读取。
 * 决定「本云控端实例是否被授权使用某商城的店铺商品图」；云控端再据此对旗下用户做 per-user 二级门控。
 *
 * 缓存策略（一次探测拿回整个 mall_authorizations map 整体缓存，兼顾「授权变更尽快生效」
 * 「授权端抖动不闪断」「授权端宕机不打请求风暴」）：
 *   - FRESH（含已授权商城 10 分钟 / 全部未授权 90 秒）：探测成功后缓存的整张 map。
 *     命中即直接返回，不再打授权端。非对称 TTL：map 里有任一商城为 true 时按稳态 10 分钟缓存；
 *     全部为 false 时只缓存 90 秒，便于授权端开通后尽快传播（最长 ~90s 生效）。
 *   - LKG（24 小时 last-known-good）：最近一次成功探测的整张 map，作为探测失败时的兜底。
 *   - 探测失败：用 LKG 兜底（无 LKG 则全 false），并把兜底 map 写入 FRESH 短暂缓存 60s，
 *     避免授权端不可达时每次拉权限都打一次 HTTP（请求风暴）。
 *
 * fail-closed：从未成功探测过且当前探测失败 → 视为未授权（false），符合「只有被授权才开放」。
 */
class EweiShopAuthorization
{
    /** 合法商城 key（与三端约定一致；新增商城在此加一行）。 */
    public const MALL_KEYS = ['ewei', 'dianda', 'qdyun'];

    /** 默认商城（无参 isAuthorized() 兼容旧调用方时使用）。 */
    public const DEFAULT_MALL = 'ewei';

    /** per-user 二级门控的 policy_key（单一来源，QuotaService 默认项据此生成）。 */
    public static function policyKey(string $mall): string
    {
        return 'allow_' . $mall . '_shop';
    }

    /** 该商城名称在 system_settings 里的 setting key（单一来源）。 */
    public static function settingKey(string $mall): string
    {
        return $mall . '_shop_mall_name';
    }

    /**
     * 契约自检：MALL_KEYS 必须与 SystemSetting::SHOP_PLATFORM_LABELS 的 key 集合完全一致，
     * 否则新增/删改商城时两处会悄悄脱节（一处认得 mall_key、另一处没有对应展示标签）。
     * 仅在非生产环境（boot 阶段）调用，不一致即抛出，把契约错误在开发/测试期暴露出来。
     */
    public static function assertContractIntegrity(): void
    {
        $mallKeys = self::MALL_KEYS;
        sort($mallKeys);

        $labelKeys = array_keys(\App\Models\SystemSetting::SHOP_PLATFORM_LABELS);
        sort($labelKeys);

        if ($mallKeys !== $labelKeys) {
            $missingInLabels = array_values(array_diff($mallKeys, $labelKeys)); // MALL_KEYS 有、LABELS 缺
            $missingInMalls = array_values(array_diff($labelKeys, $mallKeys));  // LABELS 有、MALL_KEYS 缺
            throw new \LogicException(
                'mall_key 契约不一致: MALL_KEYS=[' . implode(',', $mallKeys) . '] '
                . 'SHOP_PLATFORM_LABELS keys=[' . implode(',', $labelKeys) . ']; '
                . 'SHOP_PLATFORM_LABELS 缺少=[' . implode(',', $missingInLabels) . '] '
                . 'MALL_KEYS 缺少=[' . implode(',', $missingInMalls) . ']'
            );
        }
    }

    private const FRESH_KEY = 'ewei_shop:mall_authorizations';      // 整张 map 的稳态缓存
    private const LKG_KEY = 'ewei_shop:mall_authorizations_lkg';    // 整张 map 的 last-known-good
    private const FRESH_TTL = 600;       // map 含已授权商城时缓存 10 分钟（稳态，省回源）
    private const PENDING_TTL = 90;      // 全部未授权时只缓存 90 秒，便于授权端开通后尽快传播
    private const LKG_TTL = 86400;       // 24 小时
    private const FAIL_RETRY_TTL = 60;   // 探测失败后的短缓存，避免请求风暴

    /**
     * 判定某商城是否被一级授权。$mallKey 非法时返回 false（fail-closed）。
     * 不传参（或传空）时回退默认商城 ewei，兼容旧调用方 isAuthorized()。
     */
    public static function isAuthorized(string $mallKey = self::DEFAULT_MALL): bool
    {
        if (!in_array($mallKey, self::MALL_KEYS, true)) {
            return false;
        }
        $map = self::authorizations();
        return (bool) ($map[$mallKey] ?? false);
    }

    /**
     * 返回整张商城授权 map：{ewei:bool, dianda:bool}。命中 FRESH 缓存直接返回，否则回源探测。
     */
    public static function authorizations(): array
    {
        $fresh = Cache::get(self::FRESH_KEY);
        if (is_array($fresh)) {
            return self::normalizeMap($fresh);
        }
        return self::refresh();
    }

    /** 探测授权端（绕过 FRESH 缓存），更新缓存并返回最新的整张授权 map。 */
    public static function refresh(): array
    {
        try {
            $client = new AgentBuildClient();
            if ($client->isConfigured()) {
                $resp = $client->siteLicense();
                // 仅在拿到明确的 200 授权响应时才认定为有效结果（避免把限流 / 网络抖动当成 false）
                if ((int) ($resp['_status'] ?? 0) === 200 && ($resp['authorized'] ?? false) === true) {
                    $map = self::extractMap($resp);
                    // 非对称 TTL：有任一商城已授权按稳态 10 分钟；全部未授权只缓存 90 秒，
                    // 这样授权端刚开通后，桌面端最长 ~90s 即可拿到 true，而非等满 10 分钟。
                    $freshTtl = in_array(true, $map, true) ? self::FRESH_TTL : self::PENDING_TTL;
                    Cache::put(self::FRESH_KEY, $map, $freshTtl);
                    Cache::put(self::LKG_KEY, $map, self::LKG_TTL);
                    return $map;
                }
            }
        } catch (\Throwable $e) {
            // 忽略，走下方兜底
        }

        // 探测失败：用 last-known-good 兜底；并短暂缓存该兜底值，防止授权端宕机时每请求都打 HTTP
        $lkg = Cache::get(self::LKG_KEY);
        $fallback = is_array($lkg) ? self::normalizeMap($lkg) : self::emptyMap();
        Cache::put(self::FRESH_KEY, $fallback, self::FAIL_RETRY_TTL);
        return $fallback;
    }

    /** 清缓存（授权端改了授权、或后台手动刷新时调用）：清全部商城的整张 map 缓存。 */
    public static function forget(): void
    {
        Cache::forget(self::FRESH_KEY);
        Cache::forget(self::LKG_KEY);
    }

    /**
     * 从 license/site 响应中解析整张授权 map。
     * 优先读新字段 mall_authorizations；缺失时（旧版授权端）回退：
     *   - ewei ← can_use_ewei_shop
     *   - 其余商城 ← false（fail-closed，授权端未升级则新商城一律不可用）。
     */
    private static function extractMap(array $resp): array
    {
        $raw = $resp['mall_authorizations'] ?? null;
        if (is_array($raw)) {
            $map = self::emptyMap();
            foreach (self::MALL_KEYS as $key) {
                $map[$key] = (bool) ($raw[$key] ?? false);
            }
            return $map;
        }

        // 回退：响应缺 mall_authorizations（授权端旧版）→ 仅 ewei 读旧字段，其余 false
        $map = self::emptyMap();
        $map['ewei'] = (bool) ($resp['can_use_ewei_shop'] ?? false);
        return $map;
    }

    /** 全 false 的标准 map。 */
    private static function emptyMap(): array
    {
        return array_fill_keys(self::MALL_KEYS, false);
    }

    /** 把任意 map 规整成「仅含合法 key、值为 bool」的标准结构。 */
    private static function normalizeMap(array $map): array
    {
        $out = self::emptyMap();
        foreach (self::MALL_KEYS as $key) {
            $out[$key] = (bool) ($map[$key] ?? false);
        }
        return $out;
    }
}
