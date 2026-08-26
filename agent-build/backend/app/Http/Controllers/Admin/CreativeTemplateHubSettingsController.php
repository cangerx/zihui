<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\SystemSetting\SettingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

class CreativeTemplateHubSettingsController extends Controller
{
    private const GROUP = 'creative_template_hub';

    private const KEYS = [
        'approve_threshold',
        'reject_threshold',
        'report_threshold',
        'submit_daily_limit',
    ];

    private const DEFAULTS = [
        'approve_threshold' => 3,
        'reject_threshold' => 2,
        'report_threshold' => 5,
        'submit_daily_limit' => 20,
    ];

    public function __construct(private SettingService $settings)
    {
    }

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

        return response()->json([
            'settings' => $current,
            'defaults' => self::DEFAULTS,
            'active_reviewers' => $activeReviewers,
            'warnings' => $this->buildWarnings($current, $activeReviewers),
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'approve_threshold' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'reject_threshold' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'report_threshold' => ['sometimes', 'integer', 'min:1', 'max:1000'],
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

    private function buildWarnings(array $current, int $activeReviewers): array
    {
        $warnings = [];
        if ($activeReviewers === 0) {
            $warnings[] = [
                'code' => 'no_active_reviewers',
                'message' => '当前没有任何活跃共享库审核员，新分享的创意模板将永远停留在「待审核」状态',
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
