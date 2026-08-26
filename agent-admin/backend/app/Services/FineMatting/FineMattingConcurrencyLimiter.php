<?php

namespace App\Services\FineMatting;

use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * 精细抠图并发信号量（区别于 QPS 限流）：
 *   1. 全站并发：同时在处理（create→query 完成）的任务数 ≤ N（默认 5，对齐抠抠图单账号并发上限）
 *   2. 单用户并发：单用户同时在途任务 ≤ M（默认 3，防单人刷爆）
 *
 * 实现：
 *   - 每次 acquire 生成一个 token（同时占「全站」与「单用户」各一个槽位）。
 *   - 全站 / 单用户各维护一个「活跃 token 列表」，计数 = 列表中仍有效（Cache::has=true）的 token 数。
 *   - release() 直接 forget token key → 立即从计数中排除；列表惰性清理（下次 acquire 时 rewrite）。
 *   - token key 带 TTL 兜底：进程崩溃未 release 时，TTL 到期自动释放，避免槽位泄漏。
 *   - acquire 临界区用 Cache::lock 提升原子性（file/redis driver 均支持）；拿不到锁时降级为无锁尽力执行。
 *
 * 用法：
 *   $rl = app(FineMattingConcurrencyLimiter::class);
 *   $token = $rl->tryAcquire($userId);
 *   if (!$token) { return 429; }
 *   try { ... } finally { $rl->release($token); }
 */
class FineMattingConcurrencyLimiter
{
    private const LOCK_KEY = 'fine_matting:concurrency:lock';
    private const GLOBAL_LIST = 'fine_matting:concurrency:global';

    private int $globalConcurrency;
    private int $perUserConcurrency;
    private int $tokenTtl;

    public function __construct()
    {
        $cfg = config('koukoutu.fine_matting');
        $this->globalConcurrency  = max(1, (int) ($cfg['global_concurrency'] ?? 5));
        $this->perUserConcurrency = max(1, (int) ($cfg['per_user_concurrency'] ?? 3));
        // TTL 兜底：覆盖单任务最长耗时 + buffer
        $this->tokenTtl = max(180, (int) ($cfg['poll_timeout_seconds'] ?? 120) + 60);
    }

    /**
     * 尝试取一张许可证。返回 token 字符串（用于 release）或 false（被限流）。
     *
     * @return string|false
     */
    public function tryAcquire(int $userId)
    {
        $lock = Cache::lock(self::LOCK_KEY, 10);
        $locked = false;
        try {
            $locked = $lock->block(3);
        } catch (Throwable $e) {
            $locked = false; // 拿不到锁则降级为无锁尽力执行
        }

        try {
            return $this->doTryAcquire($userId);
        } finally {
            if ($locked) {
                try { $lock->release(); } catch (Throwable $e) { /* ignore */ }
            }
        }
    }

    private function doTryAcquire(int $userId)
    {
        // 1. 全站槽
        $globalValid = $this->validTokens(self::GLOBAL_LIST);
        if (count($globalValid) >= $this->globalConcurrency) {
            Cache::put(self::GLOBAL_LIST, $globalValid, $this->tokenTtl);
            return false;
        }

        // 2. 单用户槽
        $userListKey = $this->userListKey($userId);
        $userValid = $this->validTokens($userListKey);
        if (count($userValid) >= $this->perUserConcurrency) {
            Cache::put(self::GLOBAL_LIST, $globalValid, $this->tokenTtl);
            Cache::put($userListKey, $userValid, $this->tokenTtl);
            return false;
        }

        // 3. 发放 token，写入两个列表
        $token = 'fine_matting:slot:' . $userId . ':' . bin2hex(random_bytes(8));
        Cache::put($token, 1, $this->tokenTtl);

        $globalValid[] = $token;
        $userValid[] = $token;
        Cache::put(self::GLOBAL_LIST, $globalValid, $this->tokenTtl);
        Cache::put($userListKey, $userValid, $this->tokenTtl);

        return $token;
    }

    /**
     * 任务结束（成功 / 失败）必须调用，释放全站 + 单用户并发计数。
     */
    public function release(string $token): void
    {
        if ($token === '') {
            return;
        }
        Cache::forget($token);
    }

    /**
     * 用于管理后台展示当前实时并发压力。
     *
     * @return array{global_used:int,global_limit:int,user_used:int,user_limit:int}
     */
    public function stats(int $userId): array
    {
        return [
            'global_used'  => count($this->validTokens(self::GLOBAL_LIST)),
            'global_limit' => $this->globalConcurrency,
            'user_used'    => count($this->validTokens($this->userListKey($userId))),
            'user_limit'   => $this->perUserConcurrency,
        ];
    }

    // ===== private =====

    private function userListKey(int $userId): string
    {
        return "fine_matting:concurrency:user:{$userId}";
    }

    /** 取列表中仍有效（token key 未过期 / 未释放）的 token，顺带过滤失效项。 */
    private function validTokens(string $listKey): array
    {
        $list = Cache::get($listKey, []);
        if (!is_array($list)) {
            return [];
        }
        $valid = [];
        foreach ($list as $t) {
            if (is_string($t) && Cache::has($t)) {
                $valid[] = $t;
            }
        }
        return $valid;
    }
}
