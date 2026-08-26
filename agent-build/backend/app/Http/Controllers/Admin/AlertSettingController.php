<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\Build\BuildAlertService;
use App\Services\SystemSetting\SettingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/**
 * 运维告警通知配置（mirror 中转卡死 / worker 失联 webhook 告警）。
 *
 * 存储：system_settings group='alert'（webhook_url 加密）。
 * 同时回传 worker 三态（在线 / 忙碌 / 离线）与当前异常数，供后台一眼看清链路健康度。
 *
 * worker 三态判定（与 MirrorWatchdog 阈值保持一致）：
 *   - 在线 online：心跳在 HEARTBEAT_SILENT_MINUTES 内
 *   - 忙碌 busy ：心跳已静默，但有 build 处于 mirroring 且领取在 MIRRORING_TIMEOUT 窗口内
 *                （worker 正卡在下大包、不轮询导致心跳停更，属正常）
 *   - 离线     ：心跳静默且无进行中的 mirroring
 */
class AlertSettingController extends Controller
{
    /** worker 心跳超过这么久未刷新视为静默（与 MirrorWatchdog 一致）。 */
    private const HEARTBEAT_SILENT_MINUTES = 10;
    /** pending 超过这么久未被领取计入异常数。 */
    private const PENDING_TIMEOUT_MINUTES = 30;
    /** mirroring 超过这么久未完成计入异常数。 */
    private const MIRRORING_TIMEOUT_MINUTES = 90;

    private SettingService $settings;
    private BuildAlertService $alert;

    public function __construct(SettingService $settings, BuildAlertService $alert)
    {
        $this->settings = $settings;
        $this->alert = $alert;
    }

    /** GET /admin/api/settings/alert */
    public function show(): JsonResponse
    {
        $g = BuildAlertService::GROUP;
        $enabled = (string) $this->settings->get($g, BuildAlertService::KEY_ENABLED, '0') === '1';
        $provider = $this->alert->provider();
        $webhook = (string) $this->settings->get($g, BuildAlertService::KEY_WEBHOOK, '');
        $keyword = (string) $this->settings->get($g, BuildAlertService::KEY_KEYWORD, '');

        $now = now();
        $lastPollRaw = (string) $this->settings->get('mirror', 'worker_last_poll_at', '');
        $heartbeatFresh = $lastPollRaw !== ''
            && Carbon::parse($lastPollRaw)->gt($now->copy()->subMinutes(self::HEARTBEAT_SILENT_MINUTES));

        // worker 正在处理大包：有 build 处于 mirroring 且领取在窗口内（心跳停更但仍在干活）
        $activeMirroring = DB::table('build_requests')
            ->where('status', 'success')
            ->where('mirror_status', 'mirroring')
            ->where('mirror_assigned_at', '>=', $now->copy()->subMinutes(self::MIRRORING_TIMEOUT_MINUTES))
            ->exists();

        $busy = !$heartbeatFresh && $activeMirroring;
        $online = $heartbeatFresh || $activeMirroring;

        // 真正需要关注的异常数：pending 超时未领取 + mirroring 超时未完成
        $stuckCount = DB::table('build_requests')
                ->where('status', 'success')->where('mirror_status', 'pending')
                ->where('finished_at', '<', $now->copy()->subMinutes(self::PENDING_TIMEOUT_MINUTES))->count()
            + DB::table('build_requests')
                ->where('status', 'success')->where('mirror_status', 'mirroring')
                ->where('mirror_assigned_at', '<', $now->copy()->subMinutes(self::MIRRORING_TIMEOUT_MINUTES))->count();

        return response()->json([
            'enabled' => $enabled,
            'provider' => $provider,
            'webhook_url_masked' => $this->mask($webhook),
            'has_webhook_url' => $webhook !== '',
            'keyword' => $keyword !== '' ? $keyword : null,
            'worker' => [
                'last_poll_at' => $lastPollRaw !== '' ? $lastPollRaw : null,
                'online' => $online,
                'busy' => $busy,
            ],
            'stuck_count' => $stuckCount,
        ], 200);
    }

    /** PUT /admin/api/settings/alert */
    public function update(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'enabled' => ['required', 'boolean'],
            'provider' => ['required', Rule::in(BuildAlertService::PROVIDERS)],
            // 留空表示不修改已有 webhook（同 COS secret 的处理风格）
            'webhook_url' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'keyword' => ['sometimes', 'nullable', 'string', 'max:50'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $values = [
            BuildAlertService::KEY_ENABLED => $request->boolean('enabled') ? '1' : '0',
            BuildAlertService::KEY_PROVIDER => (string) $request->input('provider'),
        ];
        if ($request->filled('webhook_url')) {
            $values[BuildAlertService::KEY_WEBHOOK] = (string) $request->input('webhook_url');
        }
        if ($request->has('keyword')) {
            $values[BuildAlertService::KEY_KEYWORD] = (string) ($request->input('keyword') ?? '');
        }

        // webhook_url 加密存储；其余明文
        $this->settings->setGroup(BuildAlertService::GROUP, $values, [BuildAlertService::KEY_WEBHOOK]);

        return response()->json(['status' => 'ok'], 200);
    }

    /** POST /admin/api/settings/alert/test */
    public function test(): JsonResponse
    {
        $res = $this->alert->notify(
            '测试告警',
            "这是一条来自 agent-build 的测试告警。\n时间：" . now(),
            true
        );
        return response()->json(['ok' => $res['ok'], 'msg' => $res['msg']], $res['ok'] ? 200 : 422);
    }

    /** webhook 含 token，回前端时打码，仅展示首尾。 */
    private function mask(string $url): string
    {
        if ($url === '') {
            return '';
        }
        $len = strlen($url);
        if ($len <= 16) {
            return str_repeat('*', $len);
        }
        return substr($url, 0, 10) . str_repeat('*', 6) . substr($url, -6);
    }
}
