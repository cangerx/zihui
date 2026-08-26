<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\Build\CosService;
use App\Services\SystemSetting\SettingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

/**
 * 系统设置：目前包含腾讯云 COS 配置。
 *
 *   GET  /admin/api/settings/cos        读配置（secret_key 字段返 mask）
 *   PUT  /admin/api/settings/cos        改配置（secret_key 留空表示不修改）
 *   POST /admin/api/settings/cos/test   触发一次 PUT/HEAD/DELETE 联通性测试
 */
class SystemSettingsController extends Controller
{
    /** 写入时这些 key 自动 Crypt::encryptString */
    private const COS_ENCRYPTED_KEYS = ['secret_key'];

    private SettingService $settings;
    private CosService $cos;

    public function __construct(SettingService $settings, CosService $cos)
    {
        $this->settings = $settings;
        $this->cos = $cos;
    }

    /** GET /admin/api/settings/cos */
    public function getCos(): JsonResponse
    {
        $g = $this->settings->getGroup('cos');
        $secretKey = (string) ($g['secret_key'] ?? '');
        return response()->json([
            'region' => (string) ($g['region'] ?? ''),
            'bucket' => (string) ($g['bucket'] ?? ''),
            'app_id' => (string) ($g['app_id'] ?? ''),
            'secret_id' => (string) ($g['secret_id'] ?? ''),
            'secret_key_masked' => $this->mask($secretKey),
            'has_secret_key' => $secretKey !== '',
            'custom_domain' => (string) ($g['custom_domain'] ?? ''),
            'configured' => $this->cos->isConfigured(),
        ]);
    }

    /** PUT /admin/api/settings/cos */
    public function updateCos(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'region' => ['required', 'string', 'max:64'],
            // 腾讯云 bucket 命名：{name}-{appid}，appid 8-12 位数字
            'bucket' => ['required', 'string', 'regex:/^[a-z0-9][a-z0-9-]{0,49}-\d{8,12}$/'],
            'app_id' => ['nullable', 'string', 'regex:/^\d{8,12}$/'],
            'secret_id' => ['required', 'string', 'min:24', 'max:128'],
            'secret_key' => ['nullable', 'string', 'min:24', 'max:128'],
            'custom_domain' => ['nullable', 'string', 'max:255'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $payload = $validator->validated();

        // secret_key 留空 = 保留旧值（按 mask 提示前端不修改）
        if (!isset($payload['secret_key']) || $payload['secret_key'] === '') {
            unset($payload['secret_key']);
        }

        // 标准化 custom_domain：去掉尾斜杠、强制 https
        if (!empty($payload['custom_domain'])) {
            $d = trim($payload['custom_domain']);
            if (!preg_match('/^https?:\/\//', $d)) {
                $d = 'https://' . $d;
            }
            $payload['custom_domain'] = rtrim($d, '/');
        }

        $this->settings->setGroup('cos', $payload, self::COS_ENCRYPTED_KEYS);

        return response()->json(['status' => 'updated']);
    }

    /** POST /admin/api/settings/cos/test */
    public function testCos(): JsonResponse
    {
        $r = $this->cos->testConnection();
        return response()->json($r, $r['ok'] ? 200 : 422);
    }

    /**
     * 4 字符前后保留 + 中间星号，长度 ≤ 8 全星号。
     */
    private function mask(string $s): string
    {
        if ($s === '') return '';
        $len = strlen($s);
        if ($len <= 8) return str_repeat('*', $len);
        return substr($s, 0, 4) . str_repeat('*', $len - 8) . substr($s, -4);
    }
}
