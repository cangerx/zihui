<?php

namespace App\Services\Mall;

use Illuminate\Support\Facades\DB;

/**
 * 商城一级授权读写收口（按 mall_key）。
 *
 * 本服务把原先散落在 BuildClientController（域名归一化 / host 查重 / upsert 授权 + ewei 双写 + 列表聚合）
 * 与 BuildRequestController（读授权 + ewei 回退）里的逻辑统一收口为唯一真源，
 * 供「自助付费开通授权」公开页、付款回调、admin 写入/列表、auth-check 读取复用，避免 ewei 双写逻辑被复制后漏写。
 *
 * 死契约：mall_key 严格为 'ewei' / 'dianda' / 'qdyun'（三端一致，任一端不符权限即失效）。
 * 与 BuildClientController::MALL_KEYS / BuildRequestController::MALL_KEYS 必须保持同步。
 *
 * 授权模型说明：
 *   - 一级授权位存 client_mall_authorizations（client_id × mall_key × authorized，唯一索引）。
 *   - ewei 兼容旧列 authorized_clients.can_use_ewei_shop：写时双写、读时无行回退。
 *   - 永久解锁语义：authorized 为纯布尔，无有效期（与「一次付费永久开通」一致）。
 */
class MallAuthorizationService
{
    /** 合法商城 key（死契约，新增商城在此加一行 + 各端注册表同步）。 */
    public const MALL_KEYS = ['ewei', 'dianda', 'qdyun'];

    /** 商城对外展示名（自助页 / 后台列表用）。 */
    public const MALL_LABELS = [
        'ewei'   => 'eweishop',
        'dianda' => '点大商城',
        'qdyun'  => '全端云商城',
    ];

    /** 单商城价格（元）。 */
    public const PRICE_SINGLE = 50;
    /** 勾选 2~3 个商城的打包价（元）。 */
    public const PRICE_BUNDLE = 100;

    /**
     * 按勾选的「待开通」商城数量计价：1 个 = 50，2~3 个 = 100。
     * count <= 0 返回 0（调用方据此拒绝下单）。
     */
    public function priceFor(int $count): int
    {
        if ($count <= 0) {
            return 0;
        }
        return $count === 1 ? self::PRICE_SINGLE : self::PRICE_BUNDLE;
    }

    /**
     * 归一化授权域名输入 → 标准存储形态 https://host[:port]。
     * 与 BuildClientController::normalizeDomainInput 同款：支持域名 / 纯 IP / IP:端口 /
     * 带不带 http(s) 前缀 / 尾斜杠 / 大小写混写。提取不出 host 返回 null。
     */
    public function normalizeDomain(string $raw): ?string
    {
        $raw = rtrim(trim($raw), '/');
        if ($raw === '') {
            return null;
        }
        if (!preg_match('#^[a-z][a-z0-9+\-.]*://#i', $raw)) {
            $raw = 'https://' . $raw;
        }
        $parts = parse_url($raw);
        $host = $parts['host'] ?? null;
        if (!is_string($host) || $host === '') {
            return null;
        }
        $normalized = 'https://' . strtolower($host);
        if (isset($parts['port'])) {
            $normalized .= ':' . $parts['port'];
        }
        return $normalized;
    }

    /**
     * 从 origin/domain 字符串提取标准化 host（小写、忽略 scheme/端口/尾斜杠）。
     * 与 VerifyDomainBinding::extractHost 同款。
     */
    public function extractHost(string $value): ?string
    {
        $value = trim($value);
        if ($value === '') {
            return null;
        }
        $hasScheme = (bool) preg_match('#^[a-z][a-z0-9+\-.]*://#i', $value);
        $url = $hasScheme ? $value : 'https://' . $value;
        $host = parse_url($url, PHP_URL_HOST);
        return is_string($host) && $host !== '' ? strtolower($host) : null;
    }

    /**
     * 按用户输入的任意域名字符串，找出对应的 authorized_clients 行。
     * 复用 VerifyDomainBinding 的「快路径完全相等 + 慢路径 host 比较」匹配口径，
     * 保证 https://a.com 与 a.com、http://1.2.3.4 与 1.2.3.4:8080 命中同一行。
     * 未命中返回 null（自助页据此提示「域名不存在」）。
     */
    public function findClientByDomain(string $rawDomain): ?object
    {
        $normalized = $this->normalizeDomain($rawDomain);
        if ($normalized === null) {
            return null;
        }
        $incomingHost = $this->extractHost($normalized);
        if ($incomingHost === null) {
            return null;
        }

        // 快路径：完全字符串匹配（命中索引）
        $client = DB::table('authorized_clients')->where('domain', $normalized)->first();
        if ($client) {
            return $client;
        }

        // 慢路径：全表按 host 比较（authorized_clients 通常 < 几百行）
        $candidates = DB::table('authorized_clients')->get();
        foreach ($candidates as $row) {
            $rowHost = $this->extractHost((string) $row->domain);
            if ($rowHost !== null && strcasecmp($rowHost, $incomingHost) === 0) {
                return $row;
            }
        }
        return null;
    }

    /**
     * 读取某 client 的整张商城授权 map：{ ewei: bool, dianda: bool, qdyun: bool }。
     * ewei 关联表无行时回退旧列 can_use_ewei_shop（auth-check 单条读取走本方法）。
     *
     * @param object $client authorized_clients 行（须含 client_id，ewei 回退需含 can_use_ewei_shop）
     */
    public function getAuthorizations(object $client): array
    {
        $rows = DB::table('client_mall_authorizations')
            ->where('client_id', $client->client_id)
            ->whereIn('mall_key', self::MALL_KEYS)
            ->pluck('authorized', 'mall_key');

        $result = [];
        foreach (self::MALL_KEYS as $mallKey) {
            if ($rows->has($mallKey)) {
                $result[$mallKey] = (bool) (int) $rows->get($mallKey);
            } elseif ($mallKey === 'ewei') {
                $result[$mallKey] = (int) ($client->can_use_ewei_shop ?? 0) === 1;
            } else {
                $result[$mallKey] = false;
            }
        }
        return $result;
    }

    /**
     * 批量读取一组 client 的整张商城授权 map：返回 [client_id => { ewei: bool, dianda: bool, qdyun: bool }]。
     * 与 getAuthorizations 同一回退口径（ewei 关联表无行时回退旧列 can_use_ewei_shop），
     * 但只发一次 whereIn 查询（避免列表页 N+1）。
     *
     * @param  iterable<object> $clients authorized_clients 行集合（须含 client_id，ewei 回退需含 can_use_ewei_shop）
     * @return array<string,array<string,bool>>
     */
    public function getAuthorizationsBatch(iterable $clients): array
    {
        // 先收集 client_id 与各自的 ewei 旧列回退值
        $eweiLegacy = [];
        $clientIds = [];
        foreach ($clients as $client) {
            $cid = $client->client_id;
            $clientIds[] = $cid;
            $eweiLegacy[$cid] = (int) ($client->can_use_ewei_shop ?? 0) === 1;
        }

        // 预填默认值：ewei 用旧列回退，其余商城默认 false
        $map = [];
        foreach ($clientIds as $cid) {
            foreach (self::MALL_KEYS as $mallKey) {
                $map[$cid][$mallKey] = $mallKey === 'ewei' ? ($eweiLegacy[$cid] ?? false) : false;
            }
        }

        if (empty($clientIds)) {
            return $map;
        }

        // 一次 whereIn 查询，关联表里有行 → 以关联表为准（覆盖旧列回退值）
        $rows = DB::table('client_mall_authorizations')
            ->whereIn('client_id', $clientIds)
            ->whereIn('mall_key', self::MALL_KEYS)
            ->get(['client_id', 'mall_key', 'authorized']);
        foreach ($rows as $row) {
            if (!isset($map[$row->client_id])) {
                continue;
            }
            $map[$row->client_id][$row->mall_key] = (bool) (int) $row->authorized;
        }

        return $map;
    }

    /**
     * 写入某 client 某商城的一级授权位（upsert）。
     * mall_key='ewei' 时同步回写旧列 can_use_ewei_shop，保证未升级云控端走旧列也一致。
     * 本方法是 ewei「关联表 + 旧列」双写的唯一实现，admin 各写入入口
     * （setMallAuth / batchSetMallAuth / setEweiShop / batchSetEweiShop）统一调本方法。
     */
    public function setAuthorization(string $clientId, string $mallKey, bool $authorized): void
    {
        if (!in_array($mallKey, self::MALL_KEYS, true)) {
            return;
        }

        $now = now();
        // 存在则只更新 authorized/updated_at，不存在才插入并补 created_at（避免每次切换重置 created_at）。
        $row = DB::table('client_mall_authorizations')
            ->where('client_id', $clientId)
            ->where('mall_key', $mallKey);
        if ($row->exists()) {
            $row->update(['authorized' => $authorized, 'updated_at' => $now]);
        } else {
            DB::table('client_mall_authorizations')->insert([
                'client_id' => $clientId,
                'mall_key' => $mallKey,
                'authorized' => $authorized,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        // ewei：同步旧列
        if ($mallKey === 'ewei') {
            DB::table('authorized_clients')
                ->where('client_id', $clientId)
                ->update(['can_use_ewei_shop' => $authorized, 'updated_at' => $now]);
        }
    }
}
