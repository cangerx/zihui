<?php

namespace App\Services\Build;

use App\Services\SystemSetting\SettingService;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * 运维告警推送服务。
 *
 * 用途：mirror 中转卡死 / worker 失联 / 24h 超时自动失败等链路异常时，向运维推送一条
 * webhook 通知，把「静默故障」变成「主动发现」。
 *
 * 配置存储（system_settings group='alert'，沿用 BuildMaintenanceController 的 KV 模式）：
 *   - enabled      '1'/'0'
 *   - provider     dingtalk | wework | feishu | serverchan | custom
 *   - webhook_url   加密存储（is_encrypted=1）
 *   - keyword      可选关键词前缀（钉钉/企业微信「自定义关键词」安全设置要求消息含关键词）
 *
 * 渠道差异只体现在 payload 组装上，统一走一个 POST。custom 供自建告警网关用。
 */
class BuildAlertService
{
    public const GROUP = 'alert';
    public const KEY_ENABLED = 'enabled';
    public const KEY_PROVIDER = 'provider';
    public const KEY_WEBHOOK = 'webhook_url';
    public const KEY_KEYWORD = 'keyword';

    /** watchdog / ack-timeout 写入的运行时状态 key（同 group）。 */
    public const KEY_LAST_STATE = 'last_state';            // ok | alerting
    public const KEY_LAST_NOTIFIED_AT = 'last_notified_at';

    public const PROVIDERS = ['dingtalk', 'wework', 'feishu', 'serverchan', 'custom'];

    private SettingService $settings;

    public function __construct(SettingService $settings)
    {
        $this->settings = $settings;
    }

    /** 已启用且配了 webhook 才算可用。 */
    public function isEnabled(): bool
    {
        $enabled = (string) $this->settings->get(self::GROUP, self::KEY_ENABLED, '0') === '1';
        $url = (string) $this->settings->get(self::GROUP, self::KEY_WEBHOOK, '');
        return $enabled && $url !== '';
    }

    public function provider(): string
    {
        $p = (string) $this->settings->get(self::GROUP, self::KEY_PROVIDER, 'custom');
        return in_array($p, self::PROVIDERS, true) ? $p : 'custom';
    }

    /**
     * 发送一条告警。
     *
     * @param  bool  $force  true 时即使 enabled=0 也尝试发（后台「测试」按钮用），但仍要求 webhook 非空。
     * @return array{ok: bool, msg: string}
     */
    public function notify(string $title, string $text, bool $force = false): array
    {
        $url = (string) $this->settings->get(self::GROUP, self::KEY_WEBHOOK, '');
        if ($url === '') {
            return ['ok' => false, 'msg' => 'webhook_url 未配置'];
        }
        $enabled = (string) $this->settings->get(self::GROUP, self::KEY_ENABLED, '0') === '1';
        if (!$enabled && !$force) {
            return ['ok' => false, 'msg' => '告警未启用'];
        }

        $provider = $this->provider();
        $keyword = (string) $this->settings->get(self::GROUP, self::KEY_KEYWORD, '');
        // 关键词前缀：钉钉/企业微信「自定义关键词」安全设置要求文本里含关键词才放行。
        $fullTitle = $keyword !== '' ? "【{$keyword}】{$title}" : $title;
        $content = $fullTitle . "\n" . $text;

        try {
            [$payload, $asForm] = $this->buildPayload($provider, $fullTitle, $content);
            $req = Http::timeout(8)->connectTimeout(4);
            $resp = $asForm ? $req->asForm()->post($url, $payload) : $req->post($url, $payload);

            if (!$resp->successful()) {
                Log::warning('[BuildAlert] webhook http error', ['provider' => $provider, 'status' => $resp->status()]);
                return ['ok' => false, 'msg' => 'HTTP ' . $resp->status()];
            }

            // 多数机器人返回 200 但 body 里的 errcode/code 才表真实结果。
            // 钉钉/企业微信/飞书：errcode=0 成功；Server酱：code=0 成功；custom：默认视为成功。
            $body = $resp->json();
            if (is_array($body)) {
                $code = $body['errcode'] ?? $body['code'] ?? $body['StatusCode'] ?? 0;
                if ((int) $code !== 0) {
                    Log::warning('[BuildAlert] webhook business error', ['provider' => $provider, 'body' => $body]);
                    return ['ok' => false, 'msg' => '渠道返回错误：' . json_encode($body, JSON_UNESCAPED_UNICODE)];
                }
            }

            return ['ok' => true, 'msg' => '已发送'];
        } catch (\Throwable $e) {
            Log::error('[BuildAlert] transport error', ['provider' => $provider, 'error' => $e->getMessage()]);
            return ['ok' => false, 'msg' => $e->getMessage()];
        }
    }

    /**
     * 按渠道组装 payload。返回 [payload(array), asForm(bool)]。
     */
    private function buildPayload(string $provider, string $title, string $content): array
    {
        switch ($provider) {
            case 'dingtalk':
            case 'wework':
                // 钉钉与企业微信群机器人文本格式一致
                return [['msgtype' => 'text', 'text' => ['content' => $content]], false];
            case 'feishu':
                return [['msg_type' => 'text', 'content' => ['text' => $content]], false];
            case 'serverchan':
                // Server酱 / Server酱·Turbo：表单 title + desp
                return [['title' => $title, 'desp' => $content], true];
            case 'custom':
            default:
                // 自建网关：同时给 title / text / content 三个字段方便对接
                return [['title' => $title, 'text' => $content, 'content' => $content], false];
        }
    }
}
