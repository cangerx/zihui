<?php

namespace App\Http\Controllers\CloudBuild;

use App\Http\Controllers\Controller;
use App\Models\SystemSetting;
use App\Services\CloudBuild\CloudBuildBackend;
use App\Services\CloudBuild\CloudBuildIconValidator;
use App\Services\CloudBuild\CloudBuildProjectionSynchronizer;
use App\Services\CloudBuild\CloudBuildPullService;
use App\Services\CloudBuild\UpdateDirService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;

class CloudBuildController extends Controller
{
    /** POST /api/admin/cloud-build/request */
    public function request(Request $request, CloudBuildBackend $backend): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'app_name' => ['required', 'string', 'max:50'],
            'platform' => ['required', 'in:win,mac'],
            // icon_url must be produced by POST /api/admin/cloud-build/icon
            // (absolute URL on agent-admin's public origin, PNG 512-1024 1:1).
            'icon_url' => ['required', 'url', 'max:500'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $appName = $request->input('app_name');
        $platform = $request->input('platform');
        $iconUrl = $request->input('icon_url');

        // 打包前同步把关：图标必须是合规 PNG，否则立即返回明确错误，
        // 不再浪费 GitHub Actions 配额、也不再让用户在 CI 里看到晦涩的 magic mismatch
        $iconError = CloudBuildIconValidator::validateUrl($iconUrl);
        if ($iconError !== null) {
            return response()->json(['error' => 'invalid_icon', 'message' => $iconError], 422);
        }

        if (!$backend->isConfigured()) {
            return response()->json(['error' => 'agent_build_not_configured'], 503);
        }

        $deny = \App\Services\CloudBuild\PackagingLicense::denyReason($platform);
        if ($deny !== null) {
            return response()->json(['error' => $deny], 403);
        }

        $resp = $backend->requestBuild($appName, $platform, $iconUrl);
        $status = $resp['_status'] ?? 0;
        if ($status !== 200) {
            $http = in_array($status, [403, 409, 422, 429, 503], true) ? $status : 502;
            return response()->json([
                'error' => 'agent_build_rejected',
                'agent_build_status' => $status,
                'agent_build_response' => $resp,
            ], $http);
        }

        $buildId = $resp['build_id'] ?? null;
        $appVersion = $resp['app_version'] ?? '0.0.0';
        if (!$buildId) {
            return response()->json(['error' => 'malformed_agent_build_response', 'response' => $resp], 502);
        }

        $now = now();
        $userId = optional(auth()->user())->id;

        DB::table('cloud_builds')->insert([
            'build_id' => $buildId,
            'platform' => $platform,
            'app_name' => $appName,
            'app_version' => $appVersion,
            'icon_path' => $iconUrl,
            'status' => 'queued',
            'requested_by_user_id' => $userId,
            'queued_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return response()->json([
            'build_id' => $buildId,
            'status' => 'queued',
            'app_version' => $appVersion,
            'estimated_wait_seconds' => $resp['estimated_wait_seconds'] ?? 0,
        ], 200);
    }

    /** GET /api/admin/cloud-build */
    public function index(Request $request, CloudBuildProjectionSynchronizer $sync): JsonResponse
    {
        $page = max(1, (int) $request->query('page', 1));
        $pageSize = min(100, max(1, (int) $request->query('page_size', 20)));

        $q = DB::table('cloud_builds');
        if ($s = $request->query('status')) $q->where('status', $s);
        if ($p = $request->query('platform')) $q->where('platform', $p);
        if ($df = $request->query('date_from')) $q->where('created_at', '>=', $df);
        if ($dt = $request->query('date_to')) $q->where('created_at', '<=', $dt);

        $total = $q->count();
        $rows = $q->orderByDesc('created_at')
            ->skip(($page - 1) * $pageSize)
            ->take($pageSize)
            ->get([
                'id', 'build_id', 'platform', 'app_name', 'app_version', 'status',
                'filename', 'artifact_size', 'sha256', 'stored_path', 'supplementary_files',
                'requested_by_user_id', 'error_message',
                'queued_at', 'started_at', 'finished_at', 'downloaded_at', 'delivered_at',
                'created_at', 'updated_at',
            ]);

        foreach ($rows as $row) {
            if (in_array((string) $row->status, ['queued', 'building', 'success', 'downloading'], true)) {
                $sync->syncByBuildId((string) $row->build_id);
            }
        }
        $ids = $rows->pluck('id')->filter()->all();
        if ($ids !== []) {
            $fresh = DB::table('cloud_builds')->whereIn('id', $ids)->get([
                'id', 'build_id', 'platform', 'app_name', 'app_version', 'status',
                'filename', 'artifact_size', 'sha256', 'stored_path', 'supplementary_files',
                'requested_by_user_id', 'error_message',
                'queued_at', 'started_at', 'finished_at', 'downloaded_at', 'delivered_at',
                'created_at', 'updated_at',
            ])->keyBy('id');
            $rows = $rows->map(fn ($row) => $fresh->get($row->id) ?? $row);
        }

        return response()->json([
            'total' => $total,
            'page' => $page,
            'page_size' => $pageSize,
            'items' => $rows->values(),
        ], 200);
    }

    /** GET /api/admin/cloud-build/{buildId} */
    public function show(string $buildId, CloudBuildBackend $backend): JsonResponse
    {
        $local = DB::table('cloud_builds')->where('build_id', $buildId)->first();
        if (!$local) {
            return response()->json(['error' => 'cloud_build_not_found'], 404);
        }

        $remote = null;
        if (in_array($local->status, ['queued', 'building', 'success', 'downloading'])) {
            $remote = $backend->getStatus($buildId);
            $local = DB::table('cloud_builds')->where('id', $local->id)->first();
            if (($remote['_status'] ?? 0) === 200 && isset($remote['status']) && $local) {
                if ($remote['status'] !== $local->status && in_array($remote['status'], ['building', 'success', 'failed', 'cancelled', 'expired'])) {
                    $update = [
                        'status' => $remote['status'],
                        'updated_at' => now(),
                    ];
                    if ($remote['status'] === 'building' && !empty($remote['started_at'])) {
                        $update['started_at'] = $remote['started_at'];
                    }
                    if (in_array($remote['status'], ['failed', 'cancelled']) && !empty($remote['error_message'])) {
                        $update['error_message'] = $remote['error_message'];
                        $update['finished_at'] = $remote['finished_at'] ?? now();
                    }
                    DB::table('cloud_builds')->where('id', $local->id)->update($update);
                    $local = DB::table('cloud_builds')->where('id', $local->id)->first();
                }
            }
        }

        return response()->json([
            'local' => $local,
            'remote' => $remote,
        ], 200);
    }

    /**
     * POST /api/admin/cloud-build/{buildId}/refresh
     * 按需触发拉取流水（resolve → download → place → ack），供前端详情页轮询。
     * 1.2.0 起替代之前的 push notify 机制，无需客户配 cron。
     */
    public function refresh(string $buildId, CloudBuildPullService $service): JsonResponse
    {
        $r = $service->pullOne($buildId);
        $row = $r['row'];

        return response()->json([
            'outcome' => $r['outcome'],
            'message' => $r['message'],
            'build' => $row,
        ], $r['outcome'] === 'not_found' ? 404 : 200);
    }

    /**
     * POST /api/admin/cloud-build/{buildId}/retry
     * 1.2.1：重试已 failed / expired / cancelled 的任务。
     *   - 如果 agent_build_url 已存在（URL 探测过但下载阶段失败）：重置 status=success 让 pull 直接重下
     *   - 如果 URL 还没探到（还在 queued/building 阶段被取消）：重置 status=queued 让 pull 重新探
     * 重置后立刻触发一次 pullOne 拉取，调用方可立即看到状态变化。
     */
    public function retry(string $buildId, CloudBuildPullService $service): JsonResponse
    {
        $local = DB::table('cloud_builds')->where('build_id', $buildId)->first();
        if (!$local) {
            return response()->json(['error' => 'cloud_build_not_found'], 404);
        }
        if (!in_array($local->status, ['failed', 'expired', 'cancelled'])) {
            return response()->json([
                'error' => 'not_retryable',
                'current_status' => $local->status,
            ], 409);
        }

        $r = $service->retryOne($buildId);
        return response()->json([
            'outcome' => $r['outcome'],
            'message' => $r['message'],
            'build' => $r['row'],
        ], 200);
    }

    /**
     * POST /api/admin/cloud-build/{buildId}/cancel
     * body: { force?: bool }
     *
     * force=false（默认）：通知 agent-build 远端取消 + 本地标记 cancelled。
     * force=true：跳过远端调用，直接本地标记 cancelled。用于「远端不可达 / 远端卡死 /
     *   远端任务已丢失」等场景下快速清理本地记录，让管理员能继续提交新任务。
     *   注意：此模式下远端可能仍在执行，存在双跑风险，仅在确认远端已无效时使用。
     */
    public function cancel(string $buildId, Request $request, CloudBuildBackend $backend): JsonResponse
    {
        $local = DB::table('cloud_builds')->where('build_id', $buildId)->first();
        if (!$local) {
            return response()->json(['error' => 'cloud_build_not_found'], 404);
        }
        if (!in_array($local->status, ['queued', 'building'])) {
            return response()->json(['error' => 'not_cancellable', 'current_status' => $local->status], 409);
        }

        $force = $request->boolean('force', false);
        $resp = $backend->cancel($buildId, $force);
        $status = $resp['_status'] ?? 0;

        if ($force) {
            DB::table('cloud_builds')->where('id', $local->id)->update([
                'status' => 'cancelled',
                'error_message' => '管理员强制取消（远端任务可能仍在执行，未通知打包平台）',
                'finished_at' => now(),
                'updated_at' => now(),
            ]);
            return response()->json([
                'status' => 'cancelled',
                'note' => '已本地强制取消，未通知打包平台',
            ], 200);
        }

        // 1.2.5：agent-build 返 404 (build_not_found) 视为远端记录已不存在
        // （如打包平台重装、DB 数据丢失等），直接本地标记 cancelled，避免本地任务永远停留
        // 在 queued/building 无法取消。这是 fail-safe 兜底：远端没有就清掉本地，对账由用户做。
        if ($status === 404) {
            DB::table('cloud_builds')->where('id', $local->id)->update([
                'status' => 'cancelled',
                'error_message' => '打包平台已无此任务记录（可能因平台重启或维护，原任务已作废）',
                'finished_at' => now(),
                'updated_at' => now(),
            ]);
            return response()->json([
                'status' => 'cancelled',
                'note' => '打包平台已无此任务记录，已本地标记取消',
            ], 200);
        }

        if ($status !== 200) {
            return response()->json([
                'error' => 'agent_build_cancel_failed',
                'agent_build_status' => $status,
                'agent_build_response' => $resp,
            ], 502);
        }

        DB::table('cloud_builds')->where('id', $local->id)->update([
            'status' => 'cancelled',
            'finished_at' => now(),
            'updated_at' => now(),
        ]);

        return response()->json(['status' => 'cancelled'], 200);
    }

    /**
     * GET /api/admin/cloud-build/auth-check
     * 进打包页时调用：让前端在「提交打包」按钮可点之前先确认本站域名是否在 agent-build 白名单。
     * 失败时区分原因：未配置 / 域名未授权 / HMAC 错误 / agent-build 不可达。
     */
    public function authCheck(CloudBuildBackend $backend): JsonResponse
    {
        if (!$backend->isConfigured()) {
            return response()->json([
                'authorized' => false,
                'reason' => 'agent_build_not_configured',
                'message' => '本站尚未对接打包平台，请联系运维同事完成接入。',
            ], 200);
        }

        $resp = $backend->checkAuth();
        $status = $resp['_status'] ?? 0;

        if ($status === 200 && ($resp['authorized'] ?? false)) {
            unset($resp['_status']);
            return response()->json($resp, 200);
        }

        // agent-build 端拒绝：把原始错误码翻译成人话（0.2.0 起仅域名校验，错误码集合大幅精简）
        // 1.6.3 起 SDK 对非 2xx 且无 error 字段的响应合成 http_{status} 错误码，
        // 配合下方 http_ 前缀兜底翻译，"agent-build 拒绝：unknown" 不应再出现。
        // origin 显示：agent-build 回显（它实际收到的）优先，缺失时兜底 SDK 当前身份——
        // 任何失败场景用户都能看到「本站当前以哪个域名在调用」，授权排查所见即所得。
        $upstreamError = $resp['_error'] ?? $resp['error'] ?? 'unknown';
        $originShown = $this->displayHost($resp['origin'] ?? $backend->currentOrigin());
        $messageMap = [
            'origin_required' => '本站访问域名解析失败，请检查反向代理是否正确传递 Host 头',
            'domain_not_authorized' => sprintf(
                '当前域名：%s 尚未获得打包平台授权，请联系打包平台管理员将该域名加入白名单',
                $originShown !== '' ? $originShown : '(unknown)'
            ),
            'client_inactive' => '本站打包平台授权已被停用，请联系打包平台管理员',
            'client_expired' => '本站打包平台授权已过期，请联系管理员续期',
            'transport_error' => '打包平台不可达：' . ($resp['_msg'] ?? 'unknown'),
            'non_json_response' => '打包平台返回异常：' . ($resp['_msg'] ?? 'unknown'),
            'http_429' => '打包平台繁忙（请求频率受限），请稍等一分钟后重试',
            'rate_limited' => '打包平台繁忙（请求频率受限），请稍等一分钟后重试',
        ];
        $fallback = str_starts_with($upstreamError, 'http_')
            ? sprintf('打包平台返回异常状态 (HTTP %s)，请稍后重试；持续出现请联系打包平台管理员', substr($upstreamError, 5))
            : ('agent-build 拒绝：' . $upstreamError);

        $message = $messageMap[$upstreamError] ?? $fallback;
        // 非 domain_not_authorized 的失败（其文案已含域名）也带上当前站点身份，便于对照授权列表
        if ($upstreamError !== 'domain_not_authorized' && $originShown !== '') {
            $message .= "（当前站点域名：{$originShown}）";
        }

        return response()->json([
            'authorized' => false,
            'reason' => $upstreamError,
            'agent_build_status' => $status,
            'origin' => $resp['origin'] ?? $backend->currentOrigin(),
            'message' => $message,
        ], 200);
    }

    /**
     * 把 origin（https://host[:port] 形态）压成对用户友好的「域名[:端口]」显示形态；
     * 解析失败时原样返回，保证排查信息不丢。
     */
    private function displayHost(?string $origin): string
    {
        $origin = trim((string) $origin);
        if ($origin === '') {
            return '';
        }
        $candidate = preg_match('#^[a-z][a-z0-9+\-.]*://#i', $origin) ? $origin : 'https://' . $origin;
        $host = parse_url($candidate, PHP_URL_HOST);
        if (!is_string($host) || $host === '') {
            return $origin;
        }
        $port = parse_url($candidate, PHP_URL_PORT);
        return $port ? "{$host}:{$port}" : $host;
    }

    /**
     * GET /api/admin/cloud-build/template-info
     * 1.2.2 起把 SDK 的真实失败原因透传给前端，不再笼统 502 + agent_build_unavailable，
     * 否则配置缺失 / 网络断 / 域名未授权三类问题表现完全一致，运维定位极慢。
     */
    public function templateInfo(CloudBuildBackend $backend): JsonResponse
    {
        if (!$backend->isConfigured()) {
            return response()->json([
                'error' => 'agent_build_not_configured',
                'agent_build_status' => 0,
                'message' => '云打包平台地址未配置。1.2.2 起代码内置默认值，本错误不应再出现；如仍触发请联系运维检查 config 缓存。',
            ], 502);
        }

        $resp = $backend->templateInfo();
        $status = $resp['_status'] ?? 0;
        if ($status === 200) {
            unset($resp['_status']);
            return response()->json($resp, 200);
        }

        $upstreamError = $resp['_error'] ?? $resp['error'] ?? 'unknown';
        $originShown = $this->displayHost($resp['origin'] ?? $backend->currentOrigin());
        $messageMap = [
            'transport_error' => '打包平台不可达：' . ($resp['_msg'] ?? 'unknown'),
            'non_json_response' => '打包平台返回异常：' . ($resp['_msg'] ?? 'unknown'),
            'origin_required' => '本站访问域名解析失败，请检查反向代理是否正确传递 Host 头',
            'domain_not_authorized' => sprintf(
                '当前域名：%s 尚未获得打包平台授权，请联系打包平台管理员将该域名加入白名单',
                $originShown !== '' ? $originShown : '(unknown)'
            ),
            'client_inactive' => '本站打包平台授权已被停用，请联系打包平台管理员',
            'client_expired' => '本站打包平台授权已过期，请联系管理员续期',
            'http_429' => '打包平台繁忙（请求频率受限），请稍等一分钟后重试',
            'rate_limited' => '打包平台繁忙（请求频率受限），请稍等一分钟后重试',
        ];
        $fallback = str_starts_with($upstreamError, 'http_')
            ? sprintf('打包平台返回异常状态 (HTTP %s)，请稍后重试；持续出现请联系打包平台管理员', substr($upstreamError, 5))
            : ('agent-build 拒绝：' . $upstreamError);
        $message = $messageMap[$upstreamError] ?? $fallback;
        if ($upstreamError !== 'domain_not_authorized' && $originShown !== '') {
            $message .= "（当前站点域名：{$originShown}）";
        }
        return response()->json([
            'error' => 'agent_build_unavailable',
            'agent_build_status' => $status,
            'agent_build_error' => $upstreamError,
            'origin' => $resp['origin'] ?? $backend->currentOrigin(),
            'message' => $message,
        ], 502);
    }

    /**
     * GET /api/admin/cloud-build/my-info
     * 查当前站点域名对应的授权信息（姓名 / 电话 / 授权域名）。前端展示用。
     * needs_completion = true 时，前端「新打包」按钮会拦截提示先完善信息。
     */
    public function myInfo(CloudBuildBackend $backend): JsonResponse
    {
        if (!$backend->isConfigured()) {
            return response()->json(['error' => 'agent_build_not_configured'], 503);
        }

        $resp = $backend->getMyInfo();
        $status = $resp['_status'] ?? 0;
        if ($status !== 200) {
            return response()->json([
                'error' => $resp['error'] ?? 'agent_build_error',
                'agent_build_status' => $status,
                'agent_build_response' => $resp,
            ], $status >= 400 && $status < 600 ? $status : 502);
        }
        unset($resp['_status']);
        return response()->json($resp, 200);
    }

    /**
     * PUT /api/admin/cloud-build/my-info
     * 更新姓名 / 电话。
     *
     * **安全铁律**：只白名单透传 `owner_name` + `owner_phone` 两个字段给 agent-build。
     * 任何前端传入的 `domain` / `client_id` / 其他字段都会被丢弃，避免浏览器篡改
     * body 中域名把别人的行改了。真实 domain 由 agent-build 端 VerifyDomainBinding
     * 中间件按 HTTP Origin 头（由 AgentBuildClient 出口强制为 https）匹配，
     * 全链路没有地方让调用方自选域名。
     */
    public function updateMyInfo(Request $request, CloudBuildBackend $backend): JsonResponse
    {
        // 云控端先一道防线，挡掉明显错误的请求，避免无谓打 agent-build 再被拒。
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

        if (!$backend->isConfigured()) {
            return response()->json(['error' => 'agent_build_not_configured'], 503);
        }

        $resp = $backend->updateMyInfo(
            (string) $request->input('owner_name'),
            (string) $request->input('owner_phone')
        );
        $status = $resp['_status'] ?? 0;
        if ($status !== 200) {
            return response()->json([
                'error' => $resp['error'] ?? 'agent_build_error',
                'agent_build_status' => $status,
                'agent_build_response' => $resp,
            ], $status >= 400 && $status < 600 ? $status : 502);
        }
        unset($resp['_status']);
        return response()->json($resp, 200);
    }

    /**
     * GET /api/admin/cloud-build/profile
     * 返回当前持久化的应用名/图标，进打包页面时回填表单用。
     */
    public function getProfile(): JsonResponse
    {
        return response()->json([
            'app_name' => (string) SystemSetting::getValue('cloud_build_app_name', ''),
            'icon_url' => (string) SystemSetting::getValue('cloud_build_icon_url', ''),
            'customer_service_title' => (string) SystemSetting::getValue('cloud_build_customer_service_title', ''),
            'customer_service_image_url' => (string) SystemSetting::getValue('cloud_build_customer_service_image_url', ''),
        ], 200);
    }

    /**
     * PUT /api/admin/cloud-build/profile
     * 持久化应用名/图标到 system_settings，下次进入页面自动回填。
     * 字段均为可选，未传的字段保持原值不动。
     */
    public function saveProfile(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'app_name' => ['nullable', 'string', 'max:50'],
            'icon_url' => ['nullable', 'url', 'max:500'],
            'customer_service_title' => ['nullable', 'string', 'max:50'],
            'customer_service_image_url' => ['nullable', 'url', 'max:500'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        // 图标若非空必须是合规 PNG（清空保存为空字符串的情况跳过校验）
        if ($request->has('icon_url')) {
            $iconUrlInput = trim((string) $request->input('icon_url'));
            if ($iconUrlInput !== '') {
                $iconError = CloudBuildIconValidator::validateUrl($iconUrlInput);
                if ($iconError !== null) {
                    return response()->json(['error' => 'invalid_icon', 'message' => $iconError], 422);
                }
            }
        }

        if ($request->has('app_name')) {
            SystemSetting::setValue('cloud_build_app_name', (string) $request->input('app_name', ''));
        }
        if ($request->has('icon_url')) {
            SystemSetting::setValue('cloud_build_icon_url', (string) $request->input('icon_url', ''));
        }
        if ($request->has('customer_service_title')) {
            SystemSetting::setValue('cloud_build_customer_service_title', (string) $request->input('customer_service_title', ''));
        }
        if ($request->has('customer_service_image_url')) {
            SystemSetting::setValue('cloud_build_customer_service_image_url', (string) $request->input('customer_service_image_url', ''));
        }

        return $this->getProfile();
    }

    /**
     * DELETE /api/admin/cloud-build/invalid
     * 清空 cancelled / failed 状态的历史记录。如果记录上有 stored_path 指向真实文件，
     * 一并删除文件释放空间（cancelled / failed 一般无 stored_path，但兜底处理）。
     * 返回删除的记录数与文件数。
     */
    public function cleanupInvalid(): JsonResponse
    {
        $rows = DB::table('cloud_builds')
            ->whereIn('status', ['cancelled', 'failed'])
            ->get(['id', 'stored_path']);

        $publicBase = public_path();
        $filesDeleted = 0;
        foreach ($rows as $r) {
            if (empty($r->stored_path)) continue;
            $rel = ltrim(str_replace('\\', '/', (string) $r->stored_path), '/');
            // 安全校验：必须落在 updates/ 子目录下，禁止 .. 越权
            if (str_contains($rel, '..') || !str_starts_with($rel, 'updates/')) continue;
            $abs = $publicBase . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $rel);
            if (is_file($abs) && @unlink($abs)) {
                $filesDeleted++;
            }
        }

        $recordsDeleted = DB::table('cloud_builds')
            ->whereIn('status', ['cancelled', 'failed'])
            ->delete();

        return response()->json([
            'records_deleted' => $recordsDeleted,
            'files_deleted' => $filesDeleted,
        ], 200);
    }

    /**
     * GET /api/admin/cloud-build/installers
     *
     * 按「版本主文件」聚合 public/updates/ 下的安装包：
     *   - 主文件：.exe (win) / .dmg | .zip (mac)
     *   - 副文件：与主文件同名 + .blockmap 后缀（electron-updater 增量更新数据），随主文件一起呈现 + 一起删除
     *   - 元信息文件：latest.yml / latest-mac.yml 完全过滤（既不展示也不允许删，避免运维误删后桌面端在线更新链路断裂）
     *   - 孤儿文件（孤立的 .blockmap、未知后缀文件）：不展示，仅计入 total_size，由后续维护命令处理
     * 每个主文件聚合成一条记录，前端按记录粒度渲染 + 单击删除主文件 + blockmap 同步消失。
     */
    public function listInstallers(UpdateDirService $svc): JsonResponse
    {
        $base = $svc->updatesBaseDir();
        if (!is_dir($base)) {
            return response()->json([
                'base' => $base,
                'items' => [],
                'total_size' => 0,
            ], 200);
        }

        // 把 stored_path = updates/xxx 的记录索引一下，便于回填关联 build_id
        $linkMap = [];
        foreach (DB::table('cloud_builds')->whereNotNull('stored_path')->get(['build_id', 'stored_path', 'app_name', 'app_version']) as $row) {
            $linkMap[(string) $row->stored_path] = [
                'build_id' => $row->build_id,
                'app_name' => $row->app_name,
                'app_version' => $row->app_version,
            ];
        }

        // Phase 1：扫描全部文件，分主 / 副两桶
        $primaries = []; // filename => ['size'=>int, 'mtime'=>int, 'platform'=>'win'|'mac']
        $blockmaps = []; // primaryFilename => ['filename'=>string, 'size'=>int]
        $totalSize = 0;
        foreach (scandir($base) ?: [] as $f) {
            if ($f === '.' || $f === '..') continue;
            $full = $base . DIRECTORY_SEPARATOR . $f;
            if (!is_file($full)) continue;
            $size = (int) (@filesize($full) ?: 0);
            $totalSize += $size;
            $lower = strtolower($f);

            if (str_ends_with($lower, '.blockmap')) {
                $primaryName = substr($f, 0, -strlen('.blockmap'));
                $blockmaps[$primaryName] = ['filename' => $f, 'size' => $size];
                continue;
            }
            if (str_ends_with($lower, '.exe')) {
                $primaries[$f] = ['size' => $size, 'mtime' => @filemtime($full) ?: 0, 'platform' => 'win'];
                continue;
            }
            // mac 自 0.6.0 起切到 .zip（electron-updater 在 mac 上只认 zip 作为 auto-update 载体）；
            // 但 OSS 上可能还有历史遗留的 .dmg —— 两者都识别为 mac primary 以保留运维列表 + 删除能力。
            if (str_ends_with($lower, '.dmg') || str_ends_with($lower, '.zip')) {
                $primaries[$f] = ['size' => $size, 'mtime' => @filemtime($full) ?: 0, 'platform' => 'mac'];
                continue;
            }
            // .yml / .yaml / 其它文件：仅计入 total_size 不展示
        }

        // Phase 2：以主文件为单位聚合
        $items = [];
        foreach ($primaries as $name => $p) {
            $bm = $blockmaps[$name] ?? null;
            $items[] = [
                'filename' => $name,
                'platform' => $p['platform'],
                'primary_size' => $p['size'],
                'blockmap_filename' => $bm['filename'] ?? null,
                'blockmap_size' => $bm['size'] ?? 0,
                'size' => $p['size'] + ($bm['size'] ?? 0),
                'mtime' => $p['mtime'] ? date('Y-m-d H:i:s', $p['mtime']) : null,
                'linked_build' => $linkMap['updates/' . $name] ?? null,
            ];
        }

        // 按 mtime 倒序（最近的在前）
        usort($items, fn($a, $b) => strcmp((string) $b['mtime'], (string) $a['mtime']));

        return response()->json([
            'base' => $base,
            'items' => $items,
            'total_size' => $totalSize,
        ], 200);
    }

    /**
     * DELETE /api/admin/cloud-build/installers
     * query: filename （必须是版本主文件 .exe / .dmg / .zip）
     *
     * 删除 public/updates/ 下指定的「安装包主文件 + 同名 blockmap 副文件」。同时把 cloud_builds
     * 表中 stored_path = updates/{filename} 的行的 stored_path 清空，避免详情页显示已不存在的文件。
     *
     * 后缀白名单铁律（避免运维误操作把更新链路打断）：
     *   - 仅允许 .exe / .dmg / .zip 主文件
     *   - 拒绝 .yml / .yaml：电脑端 electron-updater 元信息，删了在线更新就找不到已落盘安装包
     *   - 拒绝 .blockmap：增量更新副文件，由主文件删除时联动清理，不允许单独删（避免出现没有 blockmap 但主文件还在的半残状态）
     */
    public function deleteInstaller(Request $request, UpdateDirService $svc): JsonResponse
    {
        $filename = (string) $request->query('filename', '');
        if ($filename === '') {
            $filename = (string) $request->input('filename', '');
        }
        $filename = basename($filename);
        if ($filename === '' || !preg_match('/^[A-Za-z0-9._-]+$/', $filename)) {
            return response()->json(['error' => 'invalid_filename'], 422);
        }

        $lower = strtolower($filename);
        if (str_ends_with($lower, '.yml') || str_ends_with($lower, '.yaml')) {
            return response()->json([
                'error' => 'forbidden_filename',
                'message' => '元信息文件禁止删除，误删后桌面端在线更新链路将断裂',
            ], 403);
        }
        if (str_ends_with($lower, '.blockmap')) {
            return response()->json([
                'error' => 'forbidden_filename',
                'message' => 'blockmap 副文件随主安装包一起删除，不允许单独删',
            ], 403);
        }
        if (!str_ends_with($lower, '.exe') && !str_ends_with($lower, '.dmg') && !str_ends_with($lower, '.zip')) {
            return response()->json([
                'error' => 'forbidden_filename',
                'message' => '仅允许删除 .exe / .dmg / .zip 主安装包',
            ], 403);
        }

        $base = $svc->updatesBaseDir();
        $abs = $base . DIRECTORY_SEPARATOR . $filename;
        if (!is_file($abs)) {
            return response()->json(['error' => 'file_not_found', 'filename' => $filename], 404);
        }

        $deleted = [];
        if (!@unlink($abs)) {
            Log::warning('[CloudBuild] deleteInstaller unlink failed', ['file' => $abs]);
            return response()->json(['error' => 'unlink_failed', 'filename' => $filename], 500);
        }
        $deleted[] = $filename;

        // 同步清同名 .blockmap（best-effort，副文件删失败不影响主流程）
        $blockmap = $abs . '.blockmap';
        if (is_file($blockmap)) {
            if (@unlink($blockmap)) {
                $deleted[] = $filename . '.blockmap';
            } else {
                Log::warning('[CloudBuild] deleteInstaller blockmap unlink failed', ['file' => $blockmap]);
            }
        }

        // 同步清掉 cloud_builds 中对应的 stored_path（保留记录，仅清路径，便于追溯历史）
        $affected = DB::table('cloud_builds')
            ->where('stored_path', 'updates/' . $filename)
            ->update([
                'stored_path' => null,
                'updated_at' => now(),
            ]);

        return response()->json([
            'deleted' => $deleted,
            'records_unlinked' => $affected,
        ], 200);
    }

    /**
     * GET /api/admin/cloud-build/tmp-artifacts
     *
     * 扫描 storage/app/cloud-builds/tmp/ 目录下的临时下载产物。
     * 该目录由 ArtifactDownloadService::downloadAndVerify() 写入：
     *   - 流式下载远端 artifact 时按 uuid + .bin 命名落盘
     *   - 下载完成 + sha256 校验通过后，由 CloudBuildPullService 调 atomicReplaceMany 搬到 public/updates/
     *   - 下载失败 / 校验失败 / 搬运失败一律 unlink 兜底
     * 正常状态下应当为空；残留文件多半源于 PHP 进程在 fclose 与搬运之间被强杀
     * （reboot / OOM / kill -9）。
     *
     * 返回每个 .bin 文件的大小 / mtime / 年龄（秒），并基于阈值（默认 24h）标注 is_orphan，
     * 让管理员一目了然地区分「正在下载」与「确定残留」。
     */
    public function listTmpArtifacts(Request $request): JsonResponse
    {
        $thresholdSec = max(1, (int) $request->query('orphan_after_hours', 24)) * 3600;

        $dir = storage_path('app/cloud-builds/tmp');
        if (!is_dir($dir)) {
            return response()->json([
                'base' => $dir,
                'items' => [],
                'total_size' => 0,
                'orphan_count' => 0,
                'orphan_size' => 0,
                'orphan_after_hours' => (int) ($thresholdSec / 3600),
            ], 200);
        }

        $now = time();
        $items = [];
        $totalSize = 0;
        $orphanCount = 0;
        $orphanSize = 0;
        foreach (scandir($dir) ?: [] as $f) {
            if ($f === '.' || $f === '..') continue;
            $full = $dir . DIRECTORY_SEPARATOR . $f;
            if (!is_file($full)) continue;
            $size = (int) (@filesize($full) ?: 0);
            $mtime = (int) (@filemtime($full) ?: 0);
            $ageSec = $mtime > 0 ? max(0, $now - $mtime) : 0;
            $isOrphan = $ageSec >= $thresholdSec;

            $totalSize += $size;
            if ($isOrphan) {
                $orphanCount++;
                $orphanSize += $size;
            }

            $items[] = [
                'filename'  => $f,
                'size'      => $size,
                'mtime'     => $mtime > 0 ? date('Y-m-d H:i:s', $mtime) : null,
                'age_sec'   => $ageSec,
                'is_orphan' => $isOrphan,
            ];
        }

        // 按 mtime 倒序（最近的在前），方便管理员看到正在下载的优先排上面
        usort($items, fn($a, $b) => strcmp((string) $b['mtime'], (string) $a['mtime']));

        return response()->json([
            'base'               => $dir,
            'items'              => $items,
            'total_size'         => $totalSize,
            'orphan_count'       => $orphanCount,
            'orphan_size'        => $orphanSize,
            'orphan_after_hours' => (int) ($thresholdSec / 3600),
        ], 200);
    }

    /**
     * POST /api/admin/cloud-build/tmp-artifacts/cleanup
     * Body: { min_age_hours?: int (default 24), filenames?: string[] }
     *
     * 两种用法：
     *  1. 不传 filenames：批量清理所有 mtime 早于 min_age_hours 的 .bin 文件（默认 24h）
     *  2. 传 filenames：精确清理指定文件名（仅 ^[A-Za-z0-9._-]+\.bin$，禁 path traversal）。
     *     适用于管理员从列表里勾出特定残留文件清理。
     *
     * 安全性：
     *  - 仅扫描 storage/app/cloud-builds/tmp/ 目录，不允许删其它路径
     *  - filename 必须匹配严格白名单（uuid 形式 + .bin 后缀）
     *  - 删除失败逐文件记录到响应，不阻断其它文件的清理
     *
     * 返回：deleted_count / freed_bytes / failed (按文件名 + 原因)
     */
    public function cleanupTmpArtifacts(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'min_age_hours' => ['nullable', 'integer', 'min:0', 'max:8760'], // 最长 1 年防误传
            'filenames'     => ['nullable', 'array', 'max:100'],
            'filenames.*'   => ['string', 'max:200'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $dir = storage_path('app/cloud-builds/tmp');
        if (!is_dir($dir)) {
            return response()->json([
                'deleted_count' => 0,
                'freed_bytes'   => 0,
                'failed'        => [],
            ], 200);
        }

        // min_age_hours 允许 0（管理员明确要求即时清理所有 .bin），但默认 24h 更安全
        $minAgeHours = $request->input('min_age_hours');
        $minAgeSec = ($minAgeHours === null ? 24 : (int) $minAgeHours) * 3600;
        $explicitFilenames = $request->input('filenames');
        $explicit = is_array($explicitFilenames) && count($explicitFilenames) > 0;

        $now = time();
        $deletedCount = 0;
        $freedBytes = 0;
        $failed = [];

        // 决定本次要处理的候选文件集合
        $candidates = [];
        if ($explicit) {
            foreach ($explicitFilenames as $name) {
                $name = basename((string) $name);
                if (!preg_match('/^[A-Za-z0-9._-]+\.bin$/', $name)) {
                    $failed[] = ['filename' => $name, 'error' => 'invalid_filename'];
                    continue;
                }
                $candidates[] = $name;
            }
        } else {
            foreach (scandir($dir) ?: [] as $f) {
                if ($f === '.' || $f === '..') continue;
                if (!preg_match('/^[A-Za-z0-9._-]+\.bin$/', $f)) continue;
                $candidates[] = $f;
            }
        }

        foreach ($candidates as $name) {
            $full = $dir . DIRECTORY_SEPARATOR . $name;
            if (!is_file($full)) {
                $failed[] = ['filename' => $name, 'error' => 'not_found'];
                continue;
            }
            // 非显式删除时按 min_age_sec 过滤（保护正在下载的）
            if (!$explicit) {
                $mtime = (int) (@filemtime($full) ?: 0);
                if ($mtime <= 0 || ($now - $mtime) < $minAgeSec) continue;
            }
            $size = (int) (@filesize($full) ?: 0);
            if (@unlink($full)) {
                $deletedCount++;
                $freedBytes += $size;
            } else {
                Log::warning('[CloudBuild] cleanupTmpArtifacts unlink failed', ['file' => $full]);
                $failed[] = ['filename' => $name, 'error' => 'unlink_failed'];
            }
        }

        Log::info('[CloudBuild] cleanupTmpArtifacts done', [
            'deleted_count' => $deletedCount,
            'freed_bytes'   => $freedBytes,
            'mode'          => $explicit ? 'explicit' : 'by_age',
            'min_age_hours' => $explicit ? null : (int) ($minAgeSec / 3600),
            'admin_id'      => optional(auth()->user())->id,
        ]);

        return response()->json([
            'deleted_count' => $deletedCount,
            'freed_bytes'   => $freedBytes,
            'failed'        => $failed,
        ], 200);
    }
}
