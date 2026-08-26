<?php

namespace App\Services\CloudBuild;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * 打包平台「站点身份」自动解析服务（无 UI、无 .env 依赖）。
 *
 * 背景：agent-build 按 Origin 域名白名单授权。此前 Origin 每次请求运行时推导
 * （getSchemeAndHttpHost），反代 scheme 误判、用 IP/备用域名访问后台、cron 无 HTTP
 * 上下文退化到 APP_URL(localhost) 等场景都会推错，表现为「域名明明已授权却被拒」。
 *
 * 机制（全程用户不可见、不可改）：
 *   1. 候选收集：管理后台 HTTP 请求中静默记录最近一次「可用」的访问 origin
 *      （支持域名 / 公网 IP / 内网 IP / 带端口；仅排除 localhost / 回环地址）
 *   2. 验证锁定：调 agent-build 前依次用候选探测 auth-check，通过即锁定落库，
 *      此后页面请求 / cron / 队列统一用锁定身份
 *   3. 失败自愈：调用被拒 domain_not_authorized 时（带 10 分钟冷却）自动重新
 *      解析候选并锁定新身份，平台端换绑域名后无需人工干预
 *
 * 存储：直接写 system_settings 表（不进 SystemSetting::ALLOWED_KEYS 白名单，
 * 因而不会被设置页 getAll() 暴露、没有任何可视化入口）。
 */
class BuildIdentityService
{
    private const KEY_LOCKED = 'cloud_build_identity_locked_origin';
    private const KEY_CANDIDATE = 'cloud_build_identity_candidate_origin';
    private const KEY_RECHECK_AT = 'cloud_build_identity_recheck_at';

    /** 自愈重解析冷却（秒）：防止 agent-build 故障期间被拒响应反复触发探测风暴 */
    private const RECHECK_COOLDOWN_SECONDS = 600;

    // ---- system_settings 直存（绕开白名单模型，键不会出现在任何设置 API / 界面） ----

    private static function rawGet(string $key): string
    {
        try {
            $value = DB::table('system_settings')->where('key', $key)->value('value');
            return is_string($value) ? $value : '';
        } catch (\Throwable $e) {
            return '';
        }
    }

    private static function rawPut(string $key, string $value): void
    {
        try {
            DB::table('system_settings')->updateOrInsert(
                ['key' => $key],
                ['value' => $value, 'updated_at' => now(), 'created_at' => now()]
            );
        } catch (\Throwable $e) {
            Log::warning('[BuildIdentity] persist failed', ['key' => $key, 'error' => $e->getMessage()]);
        }
    }

    // ---- 身份读写 ----

    /** 已验证锁定的站点身份 origin；未锁定返回空串 */
    public static function lockedOrigin(): string
    {
        return self::normalizeOrigin(self::rawGet(self::KEY_LOCKED));
    }

    public static function lock(string $origin): void
    {
        $normalized = self::normalizeOrigin($origin);
        if ($normalized === '' || !self::isUsableOrigin($normalized)) {
            return;
        }
        if ($normalized !== self::lockedOrigin()) {
            Log::info('[BuildIdentity] identity locked', ['origin' => $normalized]);
        }
        self::rawPut(self::KEY_LOCKED, $normalized);
    }

    /**
     * 从当前 HTTP 请求静默记录候选身份。每个使用打包平台 SDK 的请求都会路过，
     * 值未变化时零写入；CLI（cron / queue）环境无请求上下文，直接跳过。
     */
    public static function recordCandidateFromRequest(): void
    {
        try {
            if (app()->runningInConsole()) {
                return;
            }
            $req = request();
            if (!$req) {
                return;
            }
            $origin = self::normalizeOrigin(rtrim($req->getSchemeAndHttpHost(), '/'));
            if (!self::isUsableOrigin($origin)) {
                return;
            }
            if ($origin === self::normalizeOrigin(self::rawGet(self::KEY_CANDIDATE))) {
                return;
            }
            self::rawPut(self::KEY_CANDIDATE, $origin);
        } catch (\Throwable $e) {
            // 候选记录是尽力而为，绝不影响业务请求
        }
    }

    /**
     * 解析候选身份序列（去空、去重、保序）。
     * 顺序 = 可信度：已锁定身份 > 最近后台访问 origin > 当前请求 origin
     *               > 旧版显式配置（向后兼容存量站点）> APP_URL
     */
    public static function candidateOrigins(): array
    {
        $list = [];
        $list[] = self::lockedOrigin();
        $list[] = self::normalizeOrigin(self::rawGet(self::KEY_CANDIDATE));

        try {
            if (!app()->runningInConsole() && request()) {
                $list[] = self::normalizeOrigin(rtrim(request()->getSchemeAndHttpHost(), '/'));
            }
        } catch (\Throwable $e) {
            // ignore
        }

        $list[] = self::normalizeOrigin((string) config('cloudbuild.agent_build.origin', ''));
        $list[] = self::normalizeOrigin((string) config('app.url', ''));

        $unique = [];
        foreach ($list as $origin) {
            if ($origin === '' || !self::isUsableOrigin($origin)) {
                continue;
            }
            if (!in_array($origin, $unique, true)) {
                $unique[] = $origin;
            }
        }
        return $unique;
    }

    // ---- 自愈冷却 ----

    public static function shouldRecheck(): bool
    {
        $last = (int) self::rawGet(self::KEY_RECHECK_AT);
        return (time() - $last) >= self::RECHECK_COOLDOWN_SECONDS;
    }

    public static function markRecheckNow(): void
    {
        self::rawPut(self::KEY_RECHECK_AT, (string) time());
    }

    // ---- 归一化与可用性 ----

    /**
     * 归一化 origin：trim、去尾斜杠、无 scheme 补 https://、http 升 https。
     * 强制 https 的原因：agent-build 比对忽略 scheme，而反代后 Laravel 常误判 http，
     * 统一成 https 形态可避免历史踩坑（与 1.2.6 行为一致）；IP 部署同样适用。
     */
    public static function normalizeOrigin(string $origin): string
    {
        $origin = rtrim(trim($origin), '/');
        if ($origin === '') {
            return '';
        }
        if (!preg_match('#^[a-z][a-z0-9+\-.]*://#i', $origin)) {
            $origin = 'https://' . $origin;
        }
        $origin = preg_replace('#^http://#i', 'https://', $origin);

        // host 必须可解析，否则视为无效
        $host = parse_url($origin, PHP_URL_HOST);
        if (!is_string($host) || $host === '') {
            return '';
        }
        return $origin;
    }

    /**
     * origin 是否可作为站点身份：域名、公网 IP、内网 IP、带端口均可（IP 部署 + IP 授权是
     * 受支持的形态），仅排除明显不可能被平台授权的回环 / 通配地址。
     */
    public static function isUsableOrigin(string $origin): bool
    {
        if ($origin === '') {
            return false;
        }
        $host = parse_url($origin, PHP_URL_HOST);
        if (!is_string($host) || $host === '') {
            return false;
        }
        $host = strtolower(trim($host, '[]'));
        if (in_array($host, ['localhost', '::1', '0.0.0.0'], true)) {
            return false;
        }
        if (\App\Support\RetiredPublicHosts::contains($host)) {
            return false;
        }
        if (str_starts_with($host, '127.')) {
            return false;
        }
        return true;
    }
}
