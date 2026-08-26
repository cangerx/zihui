<?php

namespace App\Services\Build;

use Illuminate\Support\Facades\Cache;

/**
 * 授权端 dispatch / mirror 领取暂停闸门。
 * 与 QueueAdminController 共用同一 cache 键。
 */
class BuildDispatchPause
{
    public const CACHE_KEY = 'agent-build:dispatch_paused';

    public static function paused(): bool
    {
        try {
            return (bool) Cache::get(self::CACHE_KEY, false);
        } catch (\Throwable $e) {
            return false;
        }
    }

    public static function pause(): void
    {
        Cache::put(self::CACHE_KEY, true, now()->addDays(7));
    }

    public static function resume(): void
    {
        Cache::forget(self::CACHE_KEY);
    }
}
