<?php

namespace App\Services\Matting;

use Illuminate\Support\Facades\Cache;

/**
 * AI 抠图双层限流：
 *   1. 全站 QPS（默认 5/s）：保护阿里 viapi 接口配额
 *   2. 单用户并发（默认 3）：避免单人刷爆
 *
 * 实现：
 *   - 全站 QPS：Cache 简单计数 + TTL=1s（fixed window，最差 2x 突刺可接受）
 *   - 单用户并发：sliding window，记录每次 acquire 时间戳，超过 N 个未释放则拒绝
 *
 * 注意：
 *   - 默认 cache driver=file，多机部署需要切 redis 才能跨进程一致。
 *   - 任务完成 / 失败时必须 release()，否则配额会泄漏（PHP-FPM 进程崩溃时无 release，
 *     用 TTL 兜底 60s 自动释放）。
 *
 * 用法：
 *   $rl = app(MattingRateLimiter::class);
 *   $token = $rl->tryAcquire($userId);
 *   if (!$token) { return 429; }
 *   try { ... } finally { $rl->release($token); }
 */
class MattingRateLimiter
{
    private int $globalQps;
    private int $perUserConcurrency;
    private int $tokenTtl;

    public function __construct()
    {
        $cfg = config('aliyun.matting');
        $this->globalQps          = (int) ($cfg['global_qps'] ?? 5);
        $this->perUserConcurrency = (int) ($cfg['per_user_concurrency'] ?? 3);
        $this->tokenTtl           = max(120, (int) ($cfg['poll_timeout_seconds'] ?? 60) + 60);
    }

    /**
     * 尝试取一张许可证。返回 token 字符串（用于 release）或 false（被限流）。
     *
     * @return string|false
     */
    public function tryAcquire(int $userId)
    {
        if (!$this->tryAcquireGlobalQps()) {
            return false;
        }

        $token = $this->tryAcquireUserConcurrency($userId);
        if (!$token) {
            // 注意：全站 QPS 已经计了一次，1s 内自动释放，不需要 rollback
            return false;
        }

        return $token;
    }

    /**
     * 任务结束（成功 / 失败）必须调用，释放单用户并发计数。
     * 全站 QPS 是 fixed window 计数器，不需要主动释放。
     */
    public function release(string $token): void
    {
        // token 格式：matting:user:{userId}:{uuid}
        Cache::forget($token);
    }

    /**
     * 用于管理后台展示当前实时压力。
     *
     * @return array{global_used:int,global_limit:int,user_used:int,user_limit:int}
     */
    public function stats(int $userId): array
    {
        return [
            'global_used'  => (int) Cache::get($this->globalKey(), 0),
            'global_limit' => $this->globalQps,
            'user_used'    => $this->userActiveCount($userId),
            'user_limit'   => $this->perUserConcurrency,
        ];
    }

    // ===== private =====

    private function globalKey(): string
    {
        // 秒级 window：用当前 UNIX 秒做 key 后缀
        return 'matting:rl:global:' . time();
    }

    private function tryAcquireGlobalQps(): bool
    {
        $key = $this->globalKey();

        // 原子 increment（cache driver 不支持时 fallback get/put）
        try {
            $count = Cache::increment($key);
            if ($count === 1 || $count === true) {
                // 首次创建时设 TTL=2s（覆盖时钟漂移）
                Cache::put($key, $count, 2);
            }
        } catch (\Throwable $e) {
            $count = (int) Cache::get($key, 0) + 1;
            Cache::put($key, $count, 2);
        }

        return $count <= $this->globalQps;
    }

    private function tryAcquireUserConcurrency(int $userId): ?string
    {
        $listKey = "matting:rl:user:{$userId}:active";

        // 清理已过期的 token
        $active = Cache::get($listKey, []);
        $valid  = [];
        foreach ($active as $t) {
            if (Cache::has($t)) {
                $valid[] = $t;
            }
        }
        if (count($valid) >= $this->perUserConcurrency) {
            // 持久化清理后的列表
            Cache::put($listKey, $valid, $this->tokenTtl);
            return null;
        }

        $token = 'matting:rl:user:' . $userId . ':' . bin2hex(random_bytes(8));
        Cache::put($token, 1, $this->tokenTtl);

        $valid[] = $token;
        Cache::put($listKey, $valid, $this->tokenTtl);

        return $token;
    }

    private function userActiveCount(int $userId): int
    {
        $listKey = "matting:rl:user:{$userId}:active";
        $active  = Cache::get($listKey, []);
        $count   = 0;
        foreach ($active as $t) {
            if (Cache::has($t)) $count++;
        }
        return $count;
    }
}
