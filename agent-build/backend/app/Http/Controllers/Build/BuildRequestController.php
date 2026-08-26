<?php

namespace App\Http\Controllers\Build;

use App\Http\Controllers\Controller;
use App\Services\Build\GitHubDispatchService;
use App\Services\Build\QuotaService;
use App\Services\Mall\MallAuthorizationService;
use App\Services\SystemSetting\SettingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class BuildRequestController extends Controller
{
    /**
     * 商城一级授权读取收口到 MallAuthorizationService（含 ewei 关联表无行回退旧列）。
     * 合法 mall_key 枚举统一引用 MallAuthorizationService::MALL_KEYS，本控制器不再持有副本。
     */
    public function __construct(private MallAuthorizationService $mallAuth)
    {
    }

    /**
     * POST /api/build/request
     *
     * 0.3.3 改动：dispatch 异步化。
     *
     * 旧实现（0.3.2 及以下）：本端点同步调 GitHub workflow_dispatch（含 15s timeout），
     * 跨区慢网下整端点常耗时 5-15+s，agent-admin 默认 15s timeout 容易超时 →
     * GitHub 实际已 dispatch 成功 + agent-build 已 INSERT 行，但 agent-admin 这边
     * HTTP 已超时 → cloud_builds 没插行 → 客户端任务在云控端列表「消失」。
     *
     * 新实现：仅 INSERT build_requests（status='pending'），立即返 build_id（< 100ms）。
     * BuildDispatchPending cron 每分钟扫 pending 行调 GitHub Actions。
     *
     * 即使 cron 暂时挂掉（如 GitHub API 抖动），dispatch_attempts < 3 时会持续重试；
     * 满 3 次仍失败才 status='failed' + 退配额。
     */
    public function request(Request $request, QuotaService $quota, SettingService $settings): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');

        // 0.6.0：维护开关 + 云控端最低版本闸门（在 validator 之前，最早拦截）。
        // 错误响应里 `error` 字段直接填友好中文，老版本 agent-admin RequestPage.tsx
        // 的 onError 兜底分支会 message.error(`agent-build 拒绝: ${inner.error}`) —— 用户看得懂；
        // 新版（1.3.4+）按 `error_code` 字段精确分支做专门 UI。
        //
        // 维护期打包豁免：maintenance_exempt=1 的客户端即使全局维护开启也照常放行，
        // 用于指定客户端在维护期做生产测试 / 灰度验证。
        $maintenanceOn = (string) $settings->get('build', 'maintenance_mode', '0') === '1';
        $maintenanceExempt = (int) ($client->maintenance_exempt ?? 0) === 1;
        $maintenance = $maintenanceOn && !$maintenanceExempt;
        if ($maintenance) {
            $msgFromSettings = (string) $settings->get('build', 'maintenance_message', '');
            $msg = $msgFromSettings !== '' ? $msgFromSettings : '云打包更新维护中，暂停打包，请稍后刷新查看。';
            return response()->json([
                'error' => $msg,
                'error_code' => 'maintenance_mode',
                'maintenance' => true,
                'maintenance_message' => $msgFromSettings !== '' ? $msgFromSettings : null,
            ], 503);
        }

        $minAdminVersion = (string) $settings->get('build', 'min_admin_version', '');
        if ($minAdminVersion !== '') {
            $clientVersion = trim((string) $request->header('X-Admin-Version', ''));
            // 校验 header 格式：必须是 X.Y.Z；空 / 不规范都视为「太老不带 header」
            $isValidFormat = $clientVersion !== '' && preg_match('/^\d{1,4}\.\d{1,4}\.\d{1,4}$/', $clientVersion) === 1;
            $tooLow = !$isValidFormat || version_compare($clientVersion, $minAdminVersion, '<');
            if ($tooLow) {
                $current = $isValidFormat ? $clientVersion : '未知';
                return response()->json([
                    'error' => "云控端版本过低（当前 {$current}），请先升级到 {$minAdminVersion} 或更高版本后再申请打包。",
                    'error_code' => 'admin_version_too_low',
                    'current_admin_version' => $isValidFormat ? $clientVersion : null,
                    'min_admin_version' => $minAdminVersion,
                ], 426);
            }
        }

        $validator = Validator::make($request->all(), [
            'app_name' => ['required', 'string', 'max:50'],
            'platform' => ['required', 'string', 'in:win,mac'],
            // Absolute URL on the caller's origin, served publicly.
            // Client (agent-admin) is responsible for PNG 512-1024 1:1 validation.
            'icon_url' => ['required', 'url', 'max:500'],
            'build_mode' => ['nullable', 'string', 'in:normal,oem'],
            'oem_project_key' => ['nullable', 'string', 'regex:/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/'],
            'app_id' => ['nullable', 'string', 'max:160', 'regex:/^[A-Za-z0-9][A-Za-z0-9_.-]{2,150}$/'],
            'update_path' => ['nullable', 'string', 'max:255'],
            'build_options' => ['nullable', 'array'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $buildMode = (string) $request->input('build_mode', 'normal');
        $oemProjectKey = $buildMode === 'oem' ? (string) $request->input('oem_project_key', '') : null;
        $appId = $buildMode === 'oem' ? (string) $request->input('app_id', '') : null;
        $updatePath = $buildMode === 'oem' ? $this->normalizeUpdatePath((string) $request->input('update_path', '')) : null;
        $buildOptions = $request->input('build_options');
        if (!is_array($buildOptions)) {
            $buildOptions = [];
        }

        if ($buildMode === 'oem') {
            if ($oemProjectKey === '' || $appId === '' || $updatePath === null) {
                return response()->json([
                    'error' => 'validation_failed',
                    'details' => [
                        'oem' => ['oem_project_key, app_id and update_path are required for OEM builds'],
                    ],
                ], 422);
            }
            $expectedPath = '/updates/oem/' . $oemProjectKey . '/';
            if ($updatePath !== $expectedPath) {
                return response()->json([
                    'error' => 'validation_failed',
                    'details' => [
                        'update_path' => ["update_path must be {$expectedPath}"],
                    ],
                ], 422);
            }
            if (str_contains($appId, '..')) {
                return response()->json([
                    'error' => 'validation_failed',
                    'details' => [
                        'app_id' => ['app_id must not contain consecutive dots'],
                    ],
                ], 422);
            }
        }

        $existing = DB::table('build_requests')
            ->where('client_id', $client->client_id)
            ->whereIn('status', ['pending', 'queued', 'building'])
            ->where(function ($q) use ($buildMode, $oemProjectKey) {
                if ($buildMode === 'oem') {
                    $q->where('build_mode', 'oem')->where('oem_project_key', $oemProjectKey);
                } else {
                    $q->where(function ($qq) {
                        $qq->whereNull('build_mode')->orWhere('build_mode', 'normal');
                    });
                }
            })
            ->first();
        if ($existing) {
            return response()->json([
                'error' => 'client_busy',
                'build_id' => $existing->build_id,
                'status' => $existing->status,
            ], 409);
        }

        $today = date('Y-m-d');
        $dailyUsed = $quota->getDailyCount($client->client_id, $today);
        if ($dailyUsed >= $client->daily_limit) {
            return response()->json([
                'error' => 'quota_exceeded',
                'daily_used' => $dailyUsed,
                'daily_limit' => $client->daily_limit,
            ], 429);
        }

        $current = DB::table('template_versions')->where('is_current', 1)->first();
        $appVersion = $current ? $current->version : '0.0.0';

        $buildId = (string) Str::uuid();
        $callbackToken = bin2hex(random_bytes(32));
        $platform = $request->input('platform');
        $appName = $request->input('app_name');
        $iconUrl = $request->input('icon_url');
        $now = now();

        // 0.3.3：插 status='pending'（待 BuildDispatchPending 异步调 GitHub）。
        // dispatch_attempts 用默认值 0，dispatched_at 用默认值 NULL（迁移已加）。
        DB::table('build_requests')->insert([
            'build_id' => $buildId,
            'client_id' => $client->client_id,
            'app_name' => $appName,
            'icon_path' => $iconUrl,
            'platform' => $platform,
            'build_mode' => $buildMode,
            'oem_project_key' => $oemProjectKey,
            'app_version' => $appVersion,
            'app_id' => $appId,
            'update_path' => $updatePath,
            'build_options' => !empty($buildOptions) ? json_encode($buildOptions, JSON_UNESCAPED_SLASHES) : null,
            'status' => 'pending',
            'callback_token' => $callbackToken,
            'queued_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $quota->incrDailyCount($client->client_id, $today);

        Log::info('[BuildRequest] queued for async dispatch', [
            'build_id' => $buildId,
            'client_id' => $client->client_id,
            'platform' => $platform,
        ]);

        // 立即返回，不再阻塞同步调 GitHub。
        // 对外 status 仍为 'queued'（用户视角：任务已接受并排队），
        // 'pending' 是内部子状态（待 dispatch 到 GitHub），agent-admin 透明感知。
        return response()->json([
            'build_id' => $buildId,
            'status' => 'queued',
            'queue_position' => 1,
            'estimated_wait_seconds' => 30,
            'app_version' => $appVersion,
            'build_mode' => $buildMode,
            'oem_project_key' => $oemProjectKey,
            'app_id' => $appId,
            'update_path' => $updatePath,
        ], 200);
    }

    /**
     * GET /api/build/auth-check
     * 客户端预检接口：能进到本方法就证明 HMAC + 域名绑定都通过了。
     * 返回 client 元数据 + 当日配额，给云控端打包页用来决定是否允许「提交打包」按钮可点。
     *
     * 0.5.x：返回里附加 maintenance / maintenance_message，云控端用于在「一键云打包」
     * 页面展示「维护中暂停打包」横幅 + 禁用提交按钮。
     */
    public function authCheck(Request $request, QuotaService $quota, SettingService $settings): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');

        $today = date('Y-m-d');
        $dailyUsed = $quota->getDailyCount($client->client_id, $today);

        // 维护期打包豁免：被豁免的客户端在全局维护期仍可正常打包，
        // 故对其返回 maintenance=false（前端不展示维护横幅、不禁用提交）。
        $maintenanceOn = (string) $settings->get('build', 'maintenance_mode', '0') === '1';
        $maintenanceExempt = (int) ($client->maintenance_exempt ?? 0) === 1;
        $maintenance = $maintenanceOn && !$maintenanceExempt;
        $maintenanceMessage = $maintenance
            ? ((string) $settings->get('build', 'maintenance_message', '')) ?: null
            : null;

        // 0.6.0：返回最低 admin 版本约束（前端用于「请先升级到 X.Y.Z」横幅提示）。
        $minAdminVersionRaw = (string) $settings->get('build', 'min_admin_version', '');
        $minAdminVersion = $minAdminVersionRaw !== '' ? $minAdminVersionRaw : null;

        // 同步派生 admin_version_too_low：若云控端在请求里带了 X-Admin-Version 且低于 min，
        // 前端不必再走 client 端 semver 比较，直接看本字段即可。
        $clientVersion = trim((string) $request->header('X-Admin-Version', ''));
        $isValidFmt = $clientVersion !== '' && preg_match('/^\d{1,4}\.\d{1,4}\.\d{1,4}$/', $clientVersion) === 1;
        $adminVersionTooLow = false;
        if ($minAdminVersion !== null) {
            $adminVersionTooLow = !$isValidFmt || version_compare($clientVersion, $minAdminVersion, '<');
        }

        // 一次聚合该客户端的按商城一级授权位（ewei 回退旧列），供下方两处字段复用。
        $mallAuthorizations = $this->mallAuth->getAuthorizations($client);

        return response()->json([
            'authorized' => true,
            'client_id' => $client->client_id,
            'domain' => $client->domain,
            'status' => $client->status,
            'expires_at' => $client->expires_at,
            'daily_limit' => (int) $client->daily_limit,
            'daily_used' => (int) $dailyUsed,
            'daily_remaining' => max(0, (int) $client->daily_limit - (int) $dailyUsed),
            'monthly_limit' => (int) $client->monthly_limit,
            'maintenance' => $maintenance,
            'maintenance_message' => $maintenanceMessage,
            // 全局维护开关原始状态 + 本客户端是否被豁免：
            // 便于云控端展示「平台维护中，但本站已豁免，可正常打包」之类提示（老前端忽略多余字段无害）。
            'maintenance_active' => $maintenanceOn,
            'maintenance_exempt' => $maintenanceExempt,
            'min_admin_version' => $minAdminVersion,
            'current_admin_version' => $isValidFmt ? $clientVersion : null,
            'admin_version_too_low' => $adminVersionTooLow,
            // 功能授权：「店铺商品图」是否对该云控端开放（云控端据此对旗下用户开放该功能）
            //
            // can_use_ewei_shop：保留旧字段，老云控端仍读（= ewei 商城授权位）。
            // mall_authorizations：新增按商城聚合的授权 map { ewei: bool, dianda: bool, qdyun: bool }，
            //   新云控端据此按商城渲染。ewei 在该客户端尚未迁移到关联表时回退读旧列 can_use_ewei_shop。
            'can_use_ewei_shop' => $mallAuthorizations['ewei'],
            'mall_authorizations' => $mallAuthorizations,
        ], 200);
    }

    public function status(Request $request, string $buildId): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');
        $build = DB::table('build_requests')
            ->where('build_id', $buildId)
            ->where('client_id', $client->client_id)
            ->first();

        if (!$build) {
            return response()->json(['error' => 'build_not_found'], 404);
        }

        $estimatedRemaining = null;
        if ($build->status === 'building' && $build->started_at) {
            $elapsed = time() - strtotime($build->started_at);
            $avg = $build->platform === 'mac' ? 600 : 300;
            $estimatedRemaining = max(0, $avg - $elapsed);
        }

        return response()->json([
            'build_id' => $build->build_id,
            'platform' => $build->platform,
            'status' => $build->status,
            'queue_position' => $build->status === 'queued' ? 1 : null,
            'started_at' => $build->started_at,
            'finished_at' => $build->finished_at,
            'estimated_remaining_seconds' => $estimatedRemaining,
            'app_version' => $build->app_version,
            'build_mode' => $build->build_mode ?? 'normal',
            'oem_project_key' => $build->oem_project_key ?? null,
            'app_id' => $build->app_id ?? null,
            'update_path' => $build->update_path ?? null,
            'error_message' => $build->error_message,
        ], 200);
    }

    public function cancel(Request $request, string $buildId, QuotaService $quota, GitHubDispatchService $github): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');
        $build = DB::table('build_requests')
            ->where('build_id', $buildId)
            ->where('client_id', $client->client_id)
            ->first();

        if (!$build) {
            return response()->json(['error' => 'build_not_found'], 404);
        }

        if (in_array($build->status, ['success', 'delivered', 'purged', 'failed', 'expired', 'cancelled'])) {
            return response()->json([
                'error' => 'not_cancellable',
                'current_status' => $build->status,
            ], 409);
        }

        $now = now();

        if ($build->status === 'building' && $build->executor_run_id) {
            $github->cancelRun((int) $build->executor_run_id);
        }

        DB::table('build_requests')->where('build_id', $buildId)->update([
            'status' => 'cancelled',
            'finished_at' => $now,
            'callback_token' => null,
            'updated_at' => $now,
        ]);

        $quota->decrDailyCount($client->client_id, date('Y-m-d', strtotime($build->created_at)));

        return response()->json([
            'status' => 'cancelled',
            'quota_refunded' => true,
        ], 200);
    }

    /**
     * GET /api/build/download/{buildId}
     *
     * 0.5.0：返回家庭电脑中转方案的 mirror URL（公网可访问，国内 CDN 加速）。
     *
     * 状态机校验（云控端拿返回值判断该不该拉）：
     *  - status 不是 success / delivered → 425 not_ready
     *  - mirror_status NULL / pending / mirroring → 425，提示“家庭电脑还在推”，云控端
     *    继续轮询；家庭电脑 SFTP 推完会 wake 云控端立即过来拉
     *  - mirror_status='failed' → 410 mirror_failed
     *  - mirror_status='purged' → 410（云控端已 ack delivered，本不该再拉）
     *  - mirror_status='mirrored' 或 'purging' → 返回 mirror URL
     *
     * 不再有签名 URL 过期概念。expires_at 字段保留兼容旧 schema，填 24h 后占位值。
     */
    public function download(Request $request, string $buildId, SettingService $settings): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');
        $build = DB::table('build_requests')
            ->where('build_id', $buildId)
            ->where('client_id', $client->client_id)
            ->first();

        if (!$build) {
            return response()->json(['error' => 'build_not_found'], 404);
        }

        if (in_array($build->status, ['purged', 'expired'])) {
            return response()->json(['error' => 'artifact_expired_or_purged', 'status' => $build->status], 410);
        }

        if (!in_array($build->status, ['success', 'delivered'], true)) {
            return response()->json(['error' => 'not_ready', 'current_status' => $build->status], 425);
        }

        $mirrorStatus = (string) ($build->mirror_status ?? '');

        if ($mirrorStatus === '' || $mirrorStatus === 'pending' || $mirrorStatus === 'mirroring') {
            return response()->json([
                'error' => 'not_ready',
                'current_status' => $build->status,
                'mirror_status' => $mirrorStatus !== '' ? $mirrorStatus : null,
                'hint' => 'home_computer_mirror_in_progress',
            ], 425);
        }

        if ($mirrorStatus === 'failed') {
            return response()->json([
                'error' => 'mirror_failed',
                'mirror_status' => $mirrorStatus,
            ], 410);
        }

        if ($mirrorStatus === 'purged') {
            return response()->json([
                'error' => 'mirror_already_purged',
                'mirror_status' => $mirrorStatus,
                'hint' => 'agent-admin already acknowledged delivery; mirror files removed',
            ], 410);
        }

        // mirrored / purging：返 mirror URL
        $mirrorUrl = (string) ($build->mirror_url_primary ?? '');
        if ($mirrorUrl === '') {
            return response()->json([
                'error' => 'mirror_url_missing',
                'mirror_status' => $mirrorStatus,
            ], 503);
        }

        // 家庭电脑直连下载：解析一次直连上下文（开关 + 最新 worker 公网IP）。
        // preferred_url 仅为可选「优选」字段，url 始终保持 CDN 不变 —— 这样未升级的老云控端
        // 完全无感（继续用 url 走 CDN），升级后的云控端才会「先试 preferred_url 再回退 url」。
        $direct = $this->resolveDirectMirror($settings);

        $primaryFilename = basename((string) $build->artifact_path);
        $primary = [
            'url' => $mirrorUrl,
            'filename' => $primaryFilename,
            'size' => (int) $build->artifact_size,
            'sha256' => (string) $build->artifact_sha256,
        ];
        $primaryPreferred = $this->buildDirectMirrorUrl($direct, $build->build_id, $primaryFilename);
        if ($primaryPreferred !== null) {
            $primary['preferred_url'] = $primaryPreferred;
        }

        // 副件 mirror URL 从 mirror_supplementary JSON 里读（家庭电脑 ack 时填）。
        // 为防家庭电脑脚本 bug 漏填，下面同时以 artifact_files 为起名参考：
        // 若某个 artifact 名在 mirror_supplementary 中没 url，该文件从响应里跳。
        $supplementary = [];
        $mirrorSuppByName = [];
        foreach ($this->parseArtifactFiles($build->mirror_supplementary ?? null) as $f) {
            $name = (string) ($f['filename'] ?? '');
            if ($name !== '') {
                $mirrorSuppByName[$name] = $f;
            }
        }

        foreach ($this->parseArtifactFiles($build->artifact_files ?? null) as $file) {
            $filename = (string) ($file['filename'] ?? '');
            if ($filename === '' || $filename === $primaryFilename) continue;
            $supp = $mirrorSuppByName[$filename] ?? null;
            if (!$supp || empty($supp['url'])) continue;
            $suppEntry = [
                'url' => (string) $supp['url'],
                'filename' => $filename,
                'role' => (string) ($file['role'] ?? 'unknown'),
                'size' => $file['size'] ?? 0,
                'sha256' => $file['sha256'] ?? '',
            ];
            $suppPreferred = $this->buildDirectMirrorUrl($direct, $build->build_id, $filename);
            if ($suppPreferred !== null) {
                $suppEntry['preferred_url'] = $suppPreferred;
            }
            $supplementary[] = $suppEntry;
        }

        $expiresAt = date('c', time() + 86400);

        return response()->json([
            'build_id' => $build->build_id,
            'platform' => $build->platform,
            'status' => $build->status,
            // legacy flat field for backward compat with B-O test scripts
            'download' => $primary + ['expires_at' => $expiresAt],
            'primary' => $primary,
            'supplementary_files' => $supplementary,
            'expires_at' => $expiresAt,
            'build_mode' => $build->build_mode ?? 'normal',
            'oem_project_key' => $build->oem_project_key ?? null,
            'app_id' => $build->app_id ?? null,
            'update_path' => $build->update_path ?? null,
        ], 200);
    }

    /**
     * 解析家庭电脑直连下载上下文：返回 ['scheme','port','path_template','ip'] 或 null（关闭/无可用IP）。
     * IP 取 system_settings(group=mirror) 的 worker_ip，并按 ip_max_age_seconds 做新鲜度闸门——
     * worker 长时间没 poll（家庭电脑离线）就不再下发直连地址，只让云控端走 CDN。
     */
    private function resolveDirectMirror(SettingService $settings): ?array
    {
        $cfg = config('build.direct_mirror');
        if (empty($cfg['enabled'])) {
            return null;
        }
        $m = $settings->getGroup('mirror');
        $ip = trim((string) ($m['worker_ip'] ?? ''));
        if ($ip === '' || filter_var($ip, FILTER_VALIDATE_IP) === false) {
            return null;
        }
        $maxAge = (int) ($cfg['ip_max_age_seconds'] ?? 600);
        if ($maxAge > 0) {
            $at = (string) ($m['worker_ip_at'] ?? '');
            $ts = $at !== '' ? strtotime($at) : false;
            // 时间戳能解析且已超龄 → 视为失联，不下发；解析失败则放行（宁可多给一次直连尝试）
            if ($ts !== false && $ts < time() - $maxAge) {
                return null;
            }
        }
        return [
            'scheme' => (string) ($cfg['scheme'] ?? 'http'),
            'port' => (int) ($cfg['port'] ?? 893),
            'path_template' => (string) ($cfg['path_template'] ?? '/build-mirror/{BUILD_ID}/{FILENAME}'),
            'ip' => $ip,
        ];
    }

    /**
     * 用最新 worker IP + 相对路径模板拼出家庭电脑直连下载 URL。$direct 为 null 时返回 null。
     * 文件名做 rawurlencode 以对齐 worker 端 encodeURIComponent（nginx 解码后命中同一文件）。
     */
    private function buildDirectMirrorUrl(?array $direct, string $buildId, string $filename): ?string
    {
        if ($direct === null || $filename === '') {
            return null;
        }
        $path = str_replace(
            ['{BUILD_ID}', '{FILENAME}'],
            [$buildId, rawurlencode($filename)],
            $direct['path_template']
        );
        $scheme = $direct['scheme'];
        $port = $direct['port'];
        $portPart = (($scheme === 'http' && $port === 80) || ($scheme === 'https' && $port === 443))
            ? ''
            : ':' . $port;
        return $scheme . '://' . $direct['ip'] . $portPart . $path;
    }

    public function ack(Request $request, string $buildId): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');
        $build = DB::table('build_requests')
            ->where('build_id', $buildId)
            ->where('client_id', $client->client_id)
            ->first();

        if (!$build) {
            return response()->json(['error' => 'build_not_found'], 404);
        }

        if ($build->status !== 'success') {
            return response()->json([
                'error' => 'invalid_state_for_ack',
                'current_status' => $build->status,
            ], 409);
        }

        $validator = Validator::make($request->all(), [
            'stored_path' => ['required', 'string', 'max:500'],
            'sha256_verified' => ['required', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $now = now();
        DB::table('build_requests')->where('build_id', $buildId)->update([
            'status' => 'delivered',
            'delivered_at' => $now,
            'updated_at' => $now,
        ]);

        return response()->json(['status' => 'delivered'], 200);
    }

    public function list(Request $request): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');
        $page = max(1, (int) $request->query('page', 1));
        $pageSize = min(100, max(1, (int) $request->query('page_size', 20)));
        $statusFilter = $request->query('status');
        $platformFilter = $request->query('platform');
        $buildModeFilter = $request->query('build_mode');
        $oemProjectKeyFilter = $request->query('oem_project_key');

        $query = DB::table('build_requests')->where('client_id', $client->client_id);
        if ($statusFilter) {
            $query->where('status', $statusFilter);
        }
        if ($platformFilter) {
            $query->where('platform', $platformFilter);
        }
        if ($buildModeFilter) {
            $query->where('build_mode', $buildModeFilter);
        }
        if ($oemProjectKeyFilter) {
            $query->where('oem_project_key', $oemProjectKeyFilter);
        }

        $total = $query->count();
        $rows = $query->orderByDesc('created_at')
            ->skip(($page - 1) * $pageSize)
            ->take($pageSize)
            ->get([
                'build_id', 'platform', 'status', 'app_name', 'app_version',
                'build_mode', 'oem_project_key', 'app_id', 'update_path',
                'queued_at', 'started_at', 'finished_at', 'created_at', 'error_message',
            ]);

        return response()->json([
            'total' => $total,
            'page' => $page,
            'page_size' => $pageSize,
            'items' => $rows,
        ], 200);
    }

    // 0.5.0: serveDownload() / GET /dl/{token} 已下线。云控端 CloudBuildPullService
    // 直接拿 mirror_url_primary GET 国内 mirror 站点，不再走 agent-build 服务器流量。
    // 老实现含 SignatureService::verify + CosService::getPresignedUrl + 本地 storage
    // fallback 三条路径，全部随 /dl/{token} 路由一同下线。git log 可查历史。

    /**
     * GET /api/build/my-info
     *
     * 域名方自查接口：返回「本域名在 authorized_clients 表里登记的姓名 / 电话」。
     * 不读 client_id / daily_limit 等运营字段，只给云控端 UI 做信息维护用。
     *
     * 响应字段：
     *   - domain              : 认证通过的域名（等于请求 Origin，由 VerifyDomainBinding 中间件注入）
     *   - owner_name          : 姓名，可能是管理员批量导入时填的占位 "1" 或空
     *   - owner_phone         : 电话，可能为 null / 占位 / 不合法手机号
     *   - needs_completion    : 姓名空 / "1"，或电话不是 11 位中国大陆手机号时为 true，云控端据此拦截「新打包」
     */
    public function myInfo(Request $request): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');
        $ownerName = (string) ($client->owner_name ?? '');
        $ownerPhone = (string) ($client->owner_phone ?? '');
        $needsCompletion = self::computeNeedsCompletion($ownerName, $ownerPhone);

        return response()->json([
            'domain' => $client->domain,
            'owner_name' => $ownerName,
            'owner_phone' => $client->owner_phone,
            'needs_completion' => $needsCompletion,
        ], 200);
    }

    /**
     * 授权信息是否需要管理员完善：
     *  - 姓名为空 / 字符串 "1" → 需完善
     *  - 电话不是 11 位中国大陆手机号 → 需完善（含空、占位 '1' '2'、随便填几位等）
     * 任一字段不合规即拦截「新打包」。
     */
    private static function computeNeedsCompletion(string $name, string $phone): bool
    {
        $trimmedName = trim($name);
        if ($trimmedName === '' || $trimmedName === '1') {
            return true;
        }
        $trimmedPhone = trim($phone);
        if (!preg_match('/^1[3-9]\d{9}$/', $trimmedPhone)) {
            return true;
        }
        return false;
    }

    /**
     * PUT /api/build/my-info
     *
     * 域名方自改姓名 / 电话。**domain 不接受前端传入** —— 避免客户端伪造 body 改他人记录，
     * 固定使用 VerifyDomainBinding 按 Origin 头匹配到的 authorized_client.client_id
     * 作为 WHERE 条件，保证只能改调用者自己的行。
     */
    public function updateMyInfo(Request $request): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');

        // 前后端双重校验：即便绕过前端 Form validator 直接 curl PUT 进来，也不会把占位值写回数据库。
        // owner_name not_in:1 拒绝占位 '1'；min:2 避免单字符。
        // owner_phone 必填，强制 11 位中国大陆手机号 /^1[3-9]\d{9}$/，自然拒绝 '1' '2' 等占位。
        $validator = Validator::make($request->all(), [
            'owner_name' => ['required', 'string', 'min:2', 'max:100', 'not_in:1'],
            'owner_phone' => ['required', 'string', 'regex:/^1[3-9]\d{9}$/'],
        ], [
            'owner_name.required' => '请输入真实姓名',
            'owner_name.min' => '姓名至少 2 个字符',
            'owner_name.max' => '姓名最多 100 个字符',
            'owner_name.not_in' => '请填写真实姓名，不能使用占位值',
            'owner_phone.required' => '请输入手机号',
            'owner_phone.regex' => '请输入有效的 11 位中国大陆手机号',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $update = [
            'owner_name' => $request->input('owner_name'),
            'owner_phone' => $request->input('owner_phone'),
            'updated_at' => now(),
        ];

        DB::table('authorized_clients')
            ->where('client_id', $client->client_id)
            ->update($update);

        $updated = DB::table('authorized_clients')->where('client_id', $client->client_id)->first();
        $name = (string) $updated->owner_name;
        $phone = (string) ($updated->owner_phone ?? '');
        $needsCompletion = self::computeNeedsCompletion($name, $phone);

        return response()->json([
            'domain' => $updated->domain,
            'owner_name' => $name,
            'owner_phone' => $updated->owner_phone,
            'needs_completion' => $needsCompletion,
        ], 200);
    }

    /** @return list<array<string,mixed>> */
    private function normalizeUpdatePath(string $path): ?string
    {
        $path = trim($path);
        if ($path === '') {
            return null;
        }
        $path = str_replace('\\', '/', $path);
        if (str_starts_with($path, 'http://') || str_starts_with($path, 'https://')) {
            return null;
        }
        if (!str_starts_with($path, '/')) {
            $path = '/' . $path;
        }
        if (!str_ends_with($path, '/')) {
            $path .= '/';
        }
        if (str_contains($path, '..') || preg_match('#/{2,}#', $path)) {
            return null;
        }
        if (!preg_match('#^/updates/oem/[a-z0-9][a-z0-9-]{0,62}[a-z0-9]/$#', $path)) {
            return null;
        }
        return $path;
    }

    /** @return list<array<string,mixed>> */
    private function parseArtifactFiles($raw): array
    {
        if (is_string($raw)) {
            $decoded = json_decode($raw, true);
            return is_array($decoded) ? $decoded : [];
        }
        if (is_array($raw)) {
            return $raw;
        }
        return [];
    }
}
