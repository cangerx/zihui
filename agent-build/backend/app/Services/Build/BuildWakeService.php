<?php

namespace App\Services\Build;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * 0.3.0 起的「混合推拉」唤醒机制：
 *
 *   - 不是传统的 push notify（不带 payload，不带 secret）
 *   - 仅向云控端 POST 一个最小信号 {"build_id": "..."}，叫醒它来主动拉
 *   - 收到 wake 的云控端用现有的 Origin 域名鉴权回 agent-build 拉数据，
 *     由 agent-build 的 VerifyDomainBinding 校验「这个 build_id 属于这个 origin」
 *   - 因此 wake 端点本身无需鉴权（伪造 wake 最多让云控端发起一次自取无果的回拉）
 *
 * URL 约定：{client.domain}/api/build/wake
 *
 * 失败语义：best-effort。云控端不可达不阻塞 BuildWorker；前端轮询和（可选）cron
 * 都是 fallback 路径，wake 失败不影响最终交付。
 */
class BuildWakeService
{
    /**
     * 给一个客户端发送 wake 信号。返回是否成功投递（仅作日志/调试，不影响 BuildWorker 流程）。
     */
    public function wakeClient(object $client, string $buildId): bool
    {
        $domain = isset($client->domain) ? rtrim((string) $client->domain, '/') : '';
        if ($domain === '') {
            Log::warning('[Wake] empty client domain, skip', ['build_id' => $buildId]);
            return false;
        }

        $url = $domain . '/api/build/wake';
        try {
            $response = Http::withHeaders([
                'Content-Type' => 'application/json',
                'User-Agent' => 'agent-build/1.0 wake',
            ])->timeout(5)
              ->connectTimeout(3)
              ->post($url, ['build_id' => $buildId]);

            if ($response->successful()) {
                return true;
            }

            Log::info('[Wake] non-2xx response (client may be offline; frontend polling will recover)', [
                'url' => $url,
                'status' => $response->status(),
                'build_id' => $buildId,
            ]);
            return false;
        } catch (\Throwable $e) {
            Log::info('[Wake] transport error (client unreachable; frontend polling will recover)', [
                'url' => $url,
                'error' => $e->getMessage(),
                'build_id' => $buildId,
            ]);
            return false;
        }
    }
}
