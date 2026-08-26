<?php

namespace App\Services;

use App\Models\PaymentOrder;
use App\Models\SystemSetting;
use Illuminate\Support\Facades\Http;

/**
 * 虎皮椒（xunhupay）聚合支付服务。
 *
 * 形态：统一下单返回支付 URL / 二维码（像天阙的主扫），但有「异步 notify 回调」（像微信）。
 * 因此下单/前端复用天阙的 payUrl→code_url 语义，结算走异步 notify（幂等）+ 可选主动查单兜底。
 *
 * 签名规范（严格遵循官方 https://www.xunhupay.com/doc/api/pay.html）：
 *   - 算法：MD5
 *   - 非空参数按参数名 ASCII 字典序排序，拼成 key1=value1&key2=value2…（排除 hash 与空值）
 *   - 末尾直接拼接 APPSECRET（无连接符），再做 MD5，取 32 位小写
 *
 * 金额单位：人民币元（字符串两位小数），与微信的「分」不同。
 */
class XunhupayService
{
    /** 正式网关（可在后台 xunhupay_gateway 覆盖为备用域名 api.dpweixin.com 等） */
    private const DEFAULT_GATEWAY = 'https://api.xunhupay.com';
    private const PATH_PAY   = '/payment/do.html';
    private const PATH_QUERY = '/payment/query.html';
    private const API_VERSION = '1.1';

    private ?array $cachedConfig = null;

    /**
     * @return array{enabled: bool, appid: string, appsecret: string, gateway: string}
     */
    public function loadConfig(): array
    {
        if ($this->cachedConfig !== null) return $this->cachedConfig;

        $settings = SystemSetting::getAll();
        $gateway = trim((string)($settings['xunhupay_gateway'] ?? ''));
        return $this->cachedConfig = [
            'enabled'   => !empty($settings['xunhupay_enabled']),
            'appid'     => (string)($settings['xunhupay_appid'] ?? ''),
            'appsecret' => (string)SystemSetting::getRawValue('xunhupay_appsecret', ''),
            'gateway'   => $gateway !== '' ? rtrim($gateway, '/') : self::DEFAULT_GATEWAY,
        ];
    }

    public function isConfigured(): bool
    {
        $cfg = $this->loadConfig();
        return $cfg['enabled'] && $cfg['appid'] !== '' && $cfg['appsecret'] !== '';
    }

    /**
     * 统一下单（POST /payment/do.html）。
     *
     * @return array{payUrl: string, qrUrl: string}
     *   - payUrl：支付跳转地址（桌面端据此生成二维码供手机扫）
     *   - qrUrl ：官方 PC 二维码地址（备用，5 分钟有效）
     */
    public function nativePrepay(PaymentOrder $order, string $notifyUrl, string $title): array
    {
        if (!$this->isConfigured()) {
            throw new \RuntimeException('虎皮椒支付未配置完整');
        }
        $cfg = $this->loadConfig();

        $params = [
            'version'        => self::API_VERSION,
            'appid'          => $cfg['appid'],
            'trade_order_id' => $order->order_no,
            'total_fee'      => number_format((float)$order->amount, 2, '.', ''),
            'title'          => self::sanitizeTitle($title),
            'time'           => (string)time(),
            'notify_url'     => $notifyUrl,
            'nonce_str'      => self::nonce(),
            'plugins'        => 'agent-admin',
        ];
        $params['hash'] = $this->sign($params, $cfg['appsecret']);

        // 虎皮椒 do.html 按 form 读取 $_POST 参数并据此验签（官方 SDK 亦用 form/curl）；
        // 与 queryOrder 的 asForm 保持一致，避免 JSON body 导致服务端参数读空 → 验签失败。
        try {
            $response = Http::asForm()->timeout(15)->connectTimeout(5)
                ->post($cfg['gateway'] . self::PATH_PAY, $params);
        } catch (\Throwable $e) {
            throw new \RuntimeException('虎皮椒接口连接失败：' . $e->getMessage());
        }
        if (!$response->successful()) {
            throw new \RuntimeException('虎皮椒接口 HTTP 错误：' . $response->status());
        }
        $body = $response->json();
        if (!is_array($body)) {
            throw new \RuntimeException('虎皮椒响应格式异常');
        }
        $errcode = (int)($body['errcode'] ?? -1);
        if ($errcode !== 0) {
            throw new \RuntimeException(sprintf(
                '虎皮椒下单失败 errcode=%s errmsg=%s',
                $errcode,
                (string)($body['errmsg'] ?? '')
            ));
        }

        $payUrl = (string)($body['url'] ?? '');
        $qrUrl  = (string)($body['url_qrcode'] ?? '');
        if ($payUrl === '' && $qrUrl === '') {
            throw new \RuntimeException('虎皮椒下单返回缺少支付地址');
        }
        return [
            'payUrl' => $payUrl !== '' ? $payUrl : $qrUrl,
            'qrUrl'  => $qrUrl,
        ];
    }

    /**
     * 订单查询（POST /payment/query.html）。作为异步 notify 的兜底主动查单。
     *
     * @return array data 字段：status（OD 成功 / WP 待支付 / CD 取消）、open_order_id 等
     */
    public function queryOrder(string $orderNo): array
    {
        if (!$this->isConfigured()) {
            throw new \RuntimeException('虎皮椒支付未配置完整');
        }
        $cfg = $this->loadConfig();

        $params = [
            'appid'           => $cfg['appid'],
            'out_trade_order' => $orderNo,
            'time'            => (string)time(),
            'nonce_str'       => self::nonce(),
        ];
        $params['hash'] = $this->sign($params, $cfg['appsecret']);

        try {
            $response = Http::asForm()->timeout(15)->connectTimeout(5)
                ->post($cfg['gateway'] . self::PATH_QUERY, $params);
        } catch (\Throwable $e) {
            throw new \RuntimeException('虎皮椒查询连接失败：' . $e->getMessage());
        }
        if (!$response->successful()) {
            throw new \RuntimeException('虎皮椒查询 HTTP 错误：' . $response->status());
        }
        $body = $response->json();
        if (!is_array($body)) {
            throw new \RuntimeException('虎皮椒查询响应格式异常');
        }
        $errcode = (int)($body['errcode'] ?? -1);
        if ($errcode !== 0) {
            throw new \RuntimeException(sprintf(
                '虎皮椒查询失败 errcode=%s errmsg=%s',
                $errcode,
                (string)($body['errmsg'] ?? '')
            ));
        }
        return (array)($body['data'] ?? []);
    }

    /**
     * 验签：回调 notify 用同一 MD5 算法校验 hash。
     * $params 传原始回调全部字段（含 hash，内部会自动排除）。
     */
    public function verifyNotify(array $params): bool
    {
        $appsecret = $this->loadConfig()['appsecret'];
        if ($appsecret === '') return false;
        $provided = (string)($params['hash'] ?? '');
        if ($provided === '') return false;
        return hash_equals($this->sign($params, $appsecret), $provided);
    }

    /**
     * MD5 签名：非空参数按 key 字典序 k=v&… 拼接（排除 hash / 空值 / 数组），末尾直接拼 appsecret。
     */
    private function sign(array $params, string $appsecret): string
    {
        $filtered = [];
        foreach ($params as $k => $v) {
            if ($k === 'hash') continue;
            if ($v === null || $v === '' || is_array($v)) continue;
            $filtered[$k] = is_bool($v) ? ($v ? '1' : '0') : (string)$v;
        }
        ksort($filtered, SORT_STRING);

        $parts = [];
        foreach ($filtered as $k => $v) {
            $parts[] = "{$k}={$v}";
        }
        return md5(implode('&', $parts) . $appsecret);
    }

    private static function nonce(): string
    {
        return bin2hex(random_bytes(8));
    }

    /**
     * 订单标题：去控制字符 / 百分号 / emoji，限长（官方要求 ≤127 字符、无表情符号、无 %）。
     */
    private static function sanitizeTitle(string $raw): string
    {
        $clean = preg_replace('/[\x00-\x1F\x7F%]/u', '', $raw) ?? '';
        $clean = preg_replace('/[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{2190}-\x{21FF}\x{2B00}-\x{2BFF}]/u', '', $clean) ?? $clean;
        $clean = trim(str_replace(['\\', '"'], '', $clean));
        if ($clean === '') $clean = '在线支付';
        return mb_strcut($clean, 0, 120, 'UTF-8');
    }
}
