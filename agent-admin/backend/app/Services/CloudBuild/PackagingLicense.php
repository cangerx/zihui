<?php

namespace App\Services\CloudBuild;

use Illuminate\Support\Facades\Cache;

/**
 * 探测授权端 GET /api/license/site，缓存对齐 EweiShopAuthorization。
 */
class PackagingLicense
{
    public const ERR_NOT_LICENSED = 'packaging_not_licensed';
    public const ERR_MAC_NOT_LICENSED = 'packaging_mac_not_licensed';

    private const FRESH_KEY = 'packaging_license:flags';
    private const LKG_KEY = 'packaging_license:flags_lkg';
    private const FRESH_TTL = 600;
    private const PENDING_TTL = 90;
    private const LKG_TTL = 86400;
    private const FAIL_RETRY_TTL = 60;

    /** @var array{can_use_github_packaging:bool,can_use_mac_packaging:bool}|null */
    private static ?array $fake = null;

    /** @var callable|null */
    private static $probe = null;

    /**
     * @param array{can_use_github_packaging?:bool,can_use_mac_packaging?:bool}|null $flags
     */
    public static function fake(?array $flags): void
    {
        self::$fake = $flags === null ? null : self::normalize($flags);
    }

    public static function fakeProbe(?callable $probe): void
    {
        self::$probe = $probe;
    }

    /**
     * @return array{can_use_github_packaging:bool,can_use_mac_packaging:bool}
     */
    public static function current(): array
    {
        if (self::$fake !== null) {
            return self::$fake;
        }

        try {
            $fresh = Cache::get(self::FRESH_KEY);
            if (is_array($fresh)) {
                return self::normalize($fresh);
            }
        } catch (\Throwable $e) {
            // 单测 harness 无 Cache
        }

        return self::refresh();
    }

    public static function canUseGithub(): bool
    {
        return self::current()['can_use_github_packaging'];
    }

    public static function canUseMac(): bool
    {
        $flags = self::current();
        return $flags['can_use_github_packaging'] && $flags['can_use_mac_packaging'];
    }

    public static function denyReason(?string $platform = null): ?string
    {
        if (!self::canUseGithub()) {
            return self::ERR_NOT_LICENSED;
        }
        if ($platform === 'mac' && !self::canUseMac()) {
            return self::ERR_MAC_NOT_LICENSED;
        }
        return null;
    }

    /**
     * 设置页非空覆盖 env；空串保留 env。
     *
     * @param array<string, mixed> $env
     * @param array<string, mixed> $stored
     * @return array<string, mixed>
     */
    public static function mergeGithubConfig(array $env, array $stored): array
    {
        $repo = trim((string) ($stored['repo'] ?? ''));
        $token = trim((string) ($stored['token'] ?? ''));
        if ($repo !== '') {
            $env['repo'] = $repo;
        }
        if ($token !== '') {
            $env['token'] = $token;
        }
        return $env;
    }

    /**
     * @return array{can_use_github_packaging:bool,can_use_mac_packaging:bool}
     */
    public static function refresh(): array
    {
        if (self::$fake !== null) {
            return self::$fake;
        }

        $resp = self::probe();
        if ((int) ($resp['_status'] ?? 0) === 200 && ($resp['authorized'] ?? false) === true) {
            $map = self::normalize($resp);
            $ttl = ($map['can_use_github_packaging'] || $map['can_use_mac_packaging'])
                ? self::FRESH_TTL
                : self::PENDING_TTL;
            self::putCache(self::FRESH_KEY, $map, $ttl);
            self::putCache(self::LKG_KEY, $map, self::LKG_TTL);
            return $map;
        }

        $fallback = self::empty();
        try {
            $lkg = Cache::get(self::LKG_KEY);
            if (is_array($lkg)) {
                $fallback = self::normalize($lkg);
            }
        } catch (\Throwable $e) {
        }
        self::putCache(self::FRESH_KEY, $fallback, self::FAIL_RETRY_TTL);
        return $fallback;
    }

    public static function forget(): void
    {
        self::$fake = null;
        self::$probe = null;
        try {
            Cache::forget(self::FRESH_KEY);
            Cache::forget(self::LKG_KEY);
        } catch (\Throwable $e) {
        }
    }

    /**
     * @return array<string, mixed>
     */
    private static function probe(): array
    {
        if (is_callable(self::$probe)) {
            return (array) call_user_func(self::$probe);
        }

        try {
            $client = new AgentBuildClient();
            if (!$client->isConfigured()) {
                return ['_status' => 0];
            }
            return $client->siteLicense();
        } catch (\Throwable $e) {
            return ['_status' => 0];
        }
    }

    /**
     * @param array<string, mixed> $raw
     * @return array{can_use_github_packaging:bool,can_use_mac_packaging:bool}
     */
    public static function normalize(array $raw): array
    {
        return [
            'can_use_github_packaging' => (bool) ($raw['can_use_github_packaging'] ?? false),
            'can_use_mac_packaging' => (bool) ($raw['can_use_mac_packaging'] ?? false),
        ];
    }

    /**
     * @return array{can_use_github_packaging:bool,can_use_mac_packaging:bool}
     */
    public static function empty(): array
    {
        return [
            'can_use_github_packaging' => false,
            'can_use_mac_packaging' => false,
        ];
    }

    /**
     * @param array<string, mixed> $value
     */
    private static function putCache(string $key, array $value, int $ttl): void
    {
        try {
            Cache::put($key, $value, $ttl);
        } catch (\Throwable $e) {
        }
    }
}
