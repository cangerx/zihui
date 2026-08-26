<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\SystemSetting\SettingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

/**
 * 云打包维护开关 + 云控端最低版本要求。
 *
 * 存储位置：system_settings 表
 *   - group_key='build', setting_key='maintenance_mode'    -> '1'/'0'
 *   - group_key='build', setting_key='maintenance_message' -> 自定义维护说明，可空
 *   - group_key='build', setting_key='min_admin_version'   -> '1.3.4' 等 SemVer，可空（空=不限制）
 *
 * 读取路径（云控端可见）：BuildRequestController::authCheck 在返回里附带
 *   { maintenance: bool, maintenance_message: ?string, min_admin_version: ?string }
 * agent-admin 透传给前端，前端据此在「一键云打包」页加横幅 + 禁用提交按钮，
 * 并提示「请升级到 X.Y.Z 或以上版本」。
 *
 * 提交打包时硬闸门：BuildRequestController::request 优先级
 *   (1) maintenance=true     → 503 + error 中文文案（老版本 message.error 直接展示）
 *   (2) X-Admin-Version 缺失 → 426 + 提示需升级（更老版本不带 header）
 *   (3) X-Admin-Version < min → 426 + 提示需升级到具体版本
 */
class BuildMaintenanceController extends Controller
{
    public const GROUP = 'build';
    public const KEY_MODE = 'maintenance_mode';
    public const KEY_MESSAGE = 'maintenance_message';
    public const KEY_MIN_ADMIN_VERSION = 'min_admin_version';

    public const DEFAULT_MESSAGE = '云打包更新维护中，暂停打包，请稍后刷新查看。';

    private SettingService $settings;

    public function __construct(SettingService $settings)
    {
        $this->settings = $settings;
    }

    /** GET /admin/api/maintenance/build */
    public function show(): JsonResponse
    {
        $enabled = (string) $this->settings->get(self::GROUP, self::KEY_MODE, '0') === '1';
        $message = (string) $this->settings->get(self::GROUP, self::KEY_MESSAGE, '');
        $minVersion = (string) $this->settings->get(self::GROUP, self::KEY_MIN_ADMIN_VERSION, '');

        return response()->json([
            'enabled' => $enabled,
            'message' => $message !== '' ? $message : null,
            'default_message' => self::DEFAULT_MESSAGE,
            'min_admin_version' => $minVersion !== '' ? $minVersion : null,
        ], 200);
    }

    /** PUT /admin/api/maintenance/build */
    public function update(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'enabled' => ['required', 'boolean'],
            'message' => ['sometimes', 'nullable', 'string', 'max:500'],
            // 允许 null / 空字符串清空；非空时必须是 X.Y.Z 三段 SemVer
            'min_admin_version' => ['sometimes', 'nullable', 'string', 'max:50', 'regex:/^\d{1,4}\.\d{1,4}\.\d{1,4}$/'],
        ], [
            'min_admin_version.regex' => '最低版本号必须为 X.Y.Z 格式（如 1.3.4）',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $enabled = (bool) $request->input('enabled');
        $message = $request->has('message') ? (string) $request->input('message') : null;
        $hasMinVersion = $request->has('min_admin_version');
        $minVersion = $hasMinVersion ? (string) $request->input('min_admin_version') : null;

        $values = [self::KEY_MODE => $enabled ? '1' : '0'];
        if ($message !== null) {
            $values[self::KEY_MESSAGE] = $message;
        }
        if ($hasMinVersion) {
            // 客户端显式传 null 或空字符串视为清空
            $values[self::KEY_MIN_ADMIN_VERSION] = $minVersion ?? '';
        }

        $this->settings->setGroup(self::GROUP, $values);

        return response()->json([
            'enabled' => $enabled,
            'message' => $message !== null && $message !== '' ? $message : null,
            'min_admin_version' => $minVersion !== null && $minVersion !== '' ? $minVersion : null,
        ], 200);
    }
}
