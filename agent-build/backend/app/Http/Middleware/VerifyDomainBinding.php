<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

class VerifyDomainBinding
{
    /** 成功(allowed)记录滚动保留的最大条数：仅留最新 N 条，控制日志表体积 */
    private const ALLOWED_LOG_KEEP = 500;

    /**
     * 0.2.0 起授权模型简化为「仅域名校验」。授权识别策略：
     *
     *   1) 取请求 Origin（fallback Referer）
     *   2) 快路径：去尾斜杠后与 authorized_clients.domain **完全相等** 命中（保留索引扫描）
     *   3) 慢路径：解析双方 host 后做大小写不敏感比较（端口 / 协议 / 尾斜杠 / www 都不再敏感）
     *      —— 解决 Laravel 反代下 getSchemeAndHttpHost() 推导出 :443 / http / 大小写不一致
     *      导致严格字符串匹配失败的历史踩坑
     *
     * 通过的同时把客户端记录注入 request->attributes['authorized_client']，下游控制器复用。
     *
     * 不再校验 HMAC 签名 / 时间戳 / client_id / client_secret —— 这些字段已下线。
     */
    public function handle(Request $request, Closure $next): Response
    {
        $origin = $request->header('Origin');

        // fallback 到 Referer 的 scheme://host[:port]
        if (!$origin) {
            $referer = $request->header('Referer');
            if ($referer) {
                $parts = parse_url($referer);
                if (isset($parts['host'])) {
                    $origin = ($parts['scheme'] ?? 'https') . '://' . $parts['host'];
                    if (isset($parts['port'])) {
                        $origin .= ':' . $parts['port'];
                    }
                }
            }
        }

        if (!$origin) {
            $this->logDecision($request, 'denied', 'origin_required');
            return response()->json(['error' => 'origin_required'], 403);
        }

        $normalizedOrigin = rtrim(trim($origin), '/');
        $incomingHost = $this->extractHost($normalizedOrigin);

        if ($incomingHost === null) {
            $this->logDecision($request, 'denied', 'invalid_origin', null, $normalizedOrigin, null);
            return response()->json([
                'error' => 'invalid_origin',
                'origin' => $normalizedOrigin,
            ], 403);
        }

        // 快路径：完全字符串匹配（保留索引命中，老配置零影响）
        $client = DB::table('authorized_clients')
            ->where('domain', $normalizedOrigin)
            ->first();

        // 慢路径：按 host 比较（忽略 scheme / 端口 / 尾斜杠 / 大小写）
        // authorized_clients 表通常 < 几百行，全选 + PHP 端精确 host 比较是安全的，
        // 避免使用 LIKE 带来的子串误命中（例：ai.chaoranai.com vs evil-ai.chaoranai.com.x.com）。
        if (!$client) {
            $candidates = DB::table('authorized_clients')->get();
            foreach ($candidates as $row) {
                $rowHost = $this->extractHost((string) $row->domain);
                if ($rowHost !== null && strcasecmp($rowHost, $incomingHost) === 0) {
                    $client = $row;
                    break;
                }
            }
        }

        if (!$client) {
            $this->logDecision($request, 'denied', 'domain_not_authorized', null, $normalizedOrigin, $incomingHost);
            return response()->json([
                'error' => 'domain_not_authorized',
                'origin' => $normalizedOrigin,
            ], 403);
        }

        if ($client->status !== 'active') {
            $this->logDecision($request, 'denied', 'client_inactive', $client, $normalizedOrigin, $incomingHost);
            return response()->json([
                'error' => 'client_inactive',
                'status' => $client->status,
            ], 403);
        }

        if ($client->expires_at && strtotime($client->expires_at) < time()) {
            $this->logDecision($request, 'denied', 'client_expired', $client, $normalizedOrigin, $incomingHost);
            return response()->json(['error' => 'client_expired'], 403);
        }

        $this->logDecision($request, 'allowed', 'ok', $client, $normalizedOrigin, $incomingHost);

        $request->attributes->set('authorized_client', $client);

        return $next($request);
    }

    /**
     * 从一个 origin/domain 字符串中提取标准化 host。
     *
     * 兼容情况：
     *   - 带 scheme：https://ai.example.com[:443][/]
     *   - 不带 scheme：ai.example.com 或 ai.example.com:8080
     *   - 大小写：AI.Example.com → ai.example.com
     *   - IDN 中文域名：保留 punycode 形式（parse_url 不会解码，与数据库存储一致）
     *
     * 提取失败返回 null（外层判 403 invalid_origin）。
     */
    private function extractHost(string $value): ?string
    {
        $value = trim($value);
        if ($value === '') {
            return null;
        }

        // 没 scheme 的临时补一个，让 parse_url 走 host 分支
        $hasScheme = (bool) preg_match('#^[a-z][a-z0-9+\-.]*://#i', $value);
        $url = $hasScheme ? $value : 'https://' . $value;

        $host = parse_url($url, PHP_URL_HOST);
        return is_string($host) && $host !== '' ? strtolower($host) : null;
    }

    /**
     * 记录一次授权判定到 authorization_request_logs，供管理端「请求记录」页排查
     * 「域名已授权却报未授权」——能看到客户端实际发来的 Origin / host 与拒因。
     *
     * 铁律：绝不影响授权主流程。整段 try/catch 兜底，写库失败只告警不抛。
     * 字段按列长度截断，避免超长 UA / 构造串撑爆 varchar 触发 SQL 异常（异常被 catch
     * 吞掉等于丢日志，但授权判定本身不受影响）。
     *
     * @param object|null $client 命中的 authorized_clients 行（含 client_id / status）
     */
    private function logDecision(
        Request $request,
        string $result,
        string $reason,
        $client = null,
        ?string $origin = null,
        ?string $host = null
    ): void {
        try {
            $now = now();
            $referer = (string) $request->header('Referer');
            $ua = (string) $request->header('User-Agent');
            $adminVersion = (string) $request->header('X-Admin-Version');

            $id = DB::table('authorization_request_logs')->insertGetId([
                'result' => $result,
                'reason' => $reason,
                'origin' => $origin !== null && $origin !== '' ? mb_substr($origin, 0, 255) : null,
                'host' => $host !== null && $host !== '' ? mb_substr($host, 0, 255) : null,
                'referer' => $referer !== '' ? mb_substr($referer, 0, 512) : null,
                'client_id' => $client->client_id ?? null,
                'client_status' => $client->status ?? null,
                'ip' => $request->ip(),
                'user_agent' => $ua !== '' ? mb_substr($ua, 0, 512) : null,
                'admin_version' => $adminVersion !== '' ? mb_substr($adminVersion, 0, 32) : null,
                'method' => $request->method(),
                'path' => mb_substr($request->path(), 0, 255),
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            // 成功(allowed)记录只滚动保留最新 ALLOWED_LOG_KEEP 条以控体积：
            // 低频抽样触发裁剪（约每 100 次插入一次），避免每次成功都扫表。
            // 被拒(denied)记录不在此裁剪、全部保留，由管理端「清空」按钮手动清理。
            if ($result === 'allowed' && $id % 100 === 0) {
                $cutoffId = DB::table('authorization_request_logs')
                    ->where('result', 'allowed')
                    ->orderByDesc('id')
                    ->skip(self::ALLOWED_LOG_KEEP)
                    ->limit(1)
                    ->value('id');
                if ($cutoffId) {
                    DB::table('authorization_request_logs')
                        ->where('result', 'allowed')
                        ->where('id', '<=', $cutoffId)
                        ->delete();
                }
            }
        } catch (\Throwable $e) {
            // 写日志失败绝不能阻断授权判定，仅告警
            Log::warning('[VerifyDomainBinding] log decision failed: ' . $e->getMessage());
        }
    }
}
