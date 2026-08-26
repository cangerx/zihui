<?php

namespace App\Services\Sms;

use App\Models\SystemSetting;
use Illuminate\Support\Facades\Cache;

/**
 * 短信验证码服务：生成 / 存储 / 校验 / 防刷限流。
 *
 * 验证码存于 Laravel Cache（默认 file 驱动，单机可用；多机部署需切 Redis）。
 * - 验证码按「场景 + 手机号」隔离，避免注册码被用于找回密码等串场景攻击。
 * - 发送间隔与每日上限按「手机号」维度统计（跨场景），防止交替场景刷量。
 */
class SmsCodeService
{
    public const SCENE_REGISTER = 'register';
    public const SCENE_RESET    = 'reset_password';

    public const SCENES = [self::SCENE_REGISTER, self::SCENE_RESET];

    private AliyunSmsService $sms;

    public function __construct(?AliyunSmsService $sms = null)
    {
        // PHP 8.0 不支持「new in initializer」，故在构造体内兜底实例化
        $this->sms = $sms ?? new AliyunSmsService();
    }

    /** 是否为合法的中国大陆手机号 */
    public static function isMobile(string $mobile): bool
    {
        return (bool) preg_match('/^1[3-9]\d{9}$/', $mobile);
    }

    /**
     * 发送验证码（含限流）。
     *
     * @return array{ok:bool, message?:string, expires_in?:int, retry_after?:int}
     */
    public function send(string $scene, string $mobile): array
    {
        if (!in_array($scene, self::SCENES, true)) {
            return ['ok' => false, 'message' => '场景不合法'];
        }
        if (!self::isMobile($mobile)) {
            return ['ok' => false, 'message' => '手机号格式不正确'];
        }
        if (!SystemSetting::getValue('sms_enabled', false)) {
            return ['ok' => false, 'message' => '短信服务未开启'];
        }

        $interval   = max(0, (int) SystemSetting::getValue('sms_send_interval_seconds', 60));
        $dailyLimit = max(0, (int) SystemSetting::getValue('sms_daily_limit_per_mobile', 10));
        $expire     = max(60, (int) SystemSetting::getValue('sms_code_expire_seconds', 300));

        // 发送间隔限流
        $intervalKey = "sms:interval:{$mobile}";
        if ($interval > 0 && Cache::has($intervalKey)) {
            return ['ok' => false, 'message' => '验证码发送过于频繁，请稍后再试', 'retry_after' => $interval];
        }

        // 每日上限限流
        $dayKey = "sms:daily:{$mobile}:" . date('Ymd');
        $sentToday = (int) Cache::get($dayKey, 0);
        if ($dailyLimit > 0 && $sentToday >= $dailyLimit) {
            return ['ok' => false, 'message' => '今日验证码发送次数已达上限，请明天再试'];
        }

        $code = (string) random_int(100000, 999999);
        $templateCode = (string) SystemSetting::getValue('sms_template_code', '');

        $result = $this->sms->send($mobile, $templateCode, ['code' => $code]);
        if (!($result['ok'] ?? false)) {
            return ['ok' => false, 'message' => $result['message'] ?? '短信发送失败'];
        }

        // 发送成功后才落库计数，避免失败也占用额度
        Cache::put($this->codeKey($scene, $mobile), $code, $expire);
        if ($interval > 0) {
            Cache::put($intervalKey, 1, $interval);
        }
        Cache::put($dayKey, $sentToday + 1, now()->endOfDay());

        return ['ok' => true, 'expires_in' => $expire];
    }

    /**
     * 校验验证码；成功后一次性消费（删除），防止重放。
     */
    public function verify(string $scene, string $mobile, string $code): bool
    {
        if ($code === '' || !self::isMobile($mobile) || !in_array($scene, self::SCENES, true)) {
            return false;
        }
        $key = $this->codeKey($scene, $mobile);
        $cached = Cache::get($key);
        if ($cached === null) {
            return false;
        }
        if (!hash_equals((string) $cached, $code)) {
            return false;
        }
        Cache::forget($key);

        return true;
    }

    private function codeKey(string $scene, string $mobile): string
    {
        return "sms:code:{$scene}:{$mobile}";
    }
}
