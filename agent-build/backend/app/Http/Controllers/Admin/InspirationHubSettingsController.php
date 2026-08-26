<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\SystemSetting\SettingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/**
 * 共享灵感库 - 阈值与配额设置（auth:sanctum）。
 *
 * 4 个 system_settings key（group_key='inspiration_hub'）：
 *   approve_threshold     X 票通过审核
 *   reject_threshold      Y 票驳回审核
 *   report_threshold      N 人举报后自动下架
 *   submit_daily_limit    每客户端每天最多分享条数
 *
 * 校验：保存阈值时若 > 当前活跃审核员数会返回 warning（不阻止保存，让平台自由设定）。
 */
class InspirationHubSettingsController extends Controller
{
    private const GROUP = 'inspiration_hub';

    private const KEYS = [
        'approve_threshold',
        'reject_threshold',
        'report_threshold',
        'submit_daily_limit',
    ];

    private const DEFAULTS = [
        'approve_threshold'  => 3,
        'reject_threshold'   => 2,
        'report_threshold'   => 5,
        'submit_daily_limit' => 20,
    ];

    private SettingService $settings;

    public function __construct(SettingService $settings)
    {
        $this->settings = $settings;
    }

    /** GET /admin/api/inspiration-hub/settings */
    public function show(): JsonResponse
    {
        $current = [];
        foreach (self::KEYS as $key) {
            $current[$key] = (int) $this->settings->get(self::GROUP, $key, self::DEFAULTS[$key]);
        }

        $activeReviewers = (int) DB::table('authorized_clients')
            ->where('is_hub_reviewer', true)
            ->where('status', 'active')
            ->count();

        $warnings = $this->buildWarnings($current, $activeReviewers);

        return response()->json([
            'settings'         => $current,
            'defaults'         => self::DEFAULTS,
            'active_reviewers' => $activeReviewers,
            'warnings'         => $warnings,
        ]);
    }

    /** PUT /admin/api/inspiration-hub/settings */
    public function update(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'approve_threshold'  => ['sometimes', 'integer', 'min:1', 'max:100'],
            'reject_threshold'   => ['sometimes', 'integer', 'min:1', 'max:100'],
            'report_threshold'   => ['sometimes', 'integer', 'min:1', 'max:1000'],
            'submit_daily_limit' => ['sometimes', 'integer', 'min:1', 'max:1000'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $patch = [];
        foreach (self::KEYS as $key) {
            if ($request->has($key)) {
                $patch[$key] = (int) $request->input($key);
            }
        }
        if (empty($patch)) {
            return response()->json(['error' => 'no_change'], 422);
        }

        $this->settings->setGroup(self::GROUP, $patch);

        return $this->show();
    }

    /**
     * 构造保存后的 warnings：阈值 > 审核员数时，新分享将永远卡 pending。
     * UI 应在「设置」页用 Alert 显示。
     */
    private function buildWarnings(array $current, int $activeReviewers): array
    {
        $warnings = [];

        if ($activeReviewers === 0) {
            $warnings[] = [
                'code' => 'no_active_reviewers',
                'message' => '当前没有任何活跃审核员，新分享的灵感将永远停留在「待审核」状态',
            ];
        }

        if ($activeReviewers > 0) {
            if ($current['approve_threshold'] > $activeReviewers) {
                $warnings[] = [
                    'code' => 'approve_threshold_too_high',
                    'message' => "当前审核员仅 {$activeReviewers} 人，approve_threshold 设为 {$current['approve_threshold']} 永远无法达成",
                    'active_reviewers' => $activeReviewers,
                    'threshold' => $current['approve_threshold'],
                ];
            }
            if ($current['reject_threshold'] > $activeReviewers) {
                $warnings[] = [
                    'code' => 'reject_threshold_too_high',
                    'message' => "当前审核员仅 {$activeReviewers} 人，reject_threshold 设为 {$current['reject_threshold']} 永远无法达成",
                    'active_reviewers' => $activeReviewers,
                    'threshold' => $current['reject_threshold'],
                ];
            }
        }

        return $warnings;
    }
}
