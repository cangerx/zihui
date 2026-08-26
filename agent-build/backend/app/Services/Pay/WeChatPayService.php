<?php

namespace App\Services\Pay;

use App\Models\SelfServeOrder;
use App\Services\SystemSetting\SettingService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use WeChatPay\Builder;
use WeChatPay\BuilderChainable;
use WeChatPay\Crypto\AesGcm;
use WeChatPay\Crypto\Rsa;

/**
 * 微信支付服务封装（移植自 agent-admin，配置源改为 agent-build 的 SettingService）。
 *
 * 负责装配 SDK Builder、发起 Native 下单 / 关单 / 查单、验签+解密回调。
 * 配置全部从 system_settings(group='wechat_pay') 读取，敏感字段（apiv3_key / private_key）
 * 由 SettingService 自动解密（is_encrypted=1）。
 *
 * 收款主体由 mchid + app_id + 商户私钥 + 证书序列号 + apiv3 密钥 + 验签材料决定。
 * 仅实现 Native 扫码：跨站收款最友好（不需要 JSAPI 支付授权目录 / H5 支付域名报备）。
 */
class WeChatPayService
{
    public const SETTINGS_GROUP = 'wechat_pay';

    private SettingService $settings;

    private ?BuilderChainable $cachedBuilder = null;
    private ?string $cachedPlatformSerial = null;
    private ?array $cachedConfig = null;

    public function __construct(SettingService $settings)
    {
        $this->settings = $settings;
    }

    /**
     * 一次性装载所有微信支付配置（含解密后的密钥）。同一请求生命周期内缓存。
     *
     * @return array{enabled: bool, mchid: string, app_id: string, cert_serial_no: string, apiv3_key: string, private_key: string, platform_cert: string, pub_key_id: string, pub_key: string}
     */
    private function loadConfig(): array
    {
        if ($this->cachedConfig !== null) {
            return $this->cachedConfig;
        }

        $g = $this->settings->getGroup(self::SETTINGS_GROUP);
        return $this->cachedConfig = [
            'enabled'        => (string) ($g['enabled'] ?? '0') === '1',
            'mchid'          => (string) ($g['mchid'] ?? ''),
            'app_id'         => (string) ($g['app_id'] ?? ''),
            'cert_serial_no' => (string) ($g['cert_serial_no'] ?? ''),
            'platform_cert'  => (string) ($g['platform_cert'] ?? ''),
            'pub_key_id'     => (string) ($g['pub_key_id'] ?? ''),
            'pub_key'        => (string) ($g['pub_key'] ?? ''),
            'apiv3_key'      => (string) ($g['apiv3_key'] ?? ''),
            'private_key'    => (string) ($g['private_key'] ?? ''),
        ];
    }

    /** 是否启用公钥模式（pub_key_id + pub_key 均已配置，推荐、免轮换）。 */
    public function usePublicKeyMode(): bool
    {
        $cfg = $this->loadConfig();
        return $cfg['pub_key_id'] !== '' && $cfg['pub_key'] !== '';
    }

    /** 检查必要配置是否齐全。下单前先校验。 */
    public function isConfigured(): bool
    {
        $cfg = $this->loadConfig();
        if (!$cfg['enabled']) {
            return false;
        }
        foreach (['mchid', 'app_id', 'cert_serial_no', 'apiv3_key', 'private_key'] as $k) {
            if ($cfg[$k] === '') {
                return false;
            }
        }
        $hasPubKey = $cfg['pub_key_id'] !== '' && $cfg['pub_key'] !== '';
        $hasPlatformCert = $cfg['platform_cert'] !== '';
        return $hasPubKey || $hasPlatformCert;
    }

    /** Native 下单（商城授权单）：成功返回 code_url（二维码内容）。 */
    public function nativePrepay(SelfServeOrder $order, string $notifyUrl, string $description): string
    {
        return $this->nativePrepayRaw(
            $order->order_no,
            (string) $order->amount,
            (string) $order->currency,
            $order->expires_at,
            $notifyUrl,
            $description
        );
    }

    /**
     * Native 下单（通用原语）：不绑定具体订单模型，供多种自助订单（商城授权 / 开源交付等）复用。
     * 成功返回 code_url（二维码内容）。
     *
     * @param string             $amount    金额（元，字符串，如 "500.00"）
     * @param \DateTimeInterface $expiresAt 订单过期时间（同步给微信 time_expire）
     */
    public function nativePrepayRaw(
        string $orderNo,
        string $amount,
        string $currency,
        \DateTimeInterface $expiresAt,
        string $notifyUrl,
        string $description
    ): string {
        $builder = $this->builder();
        $cfg = $this->loadConfig();

        $totalCents = (int) bcmul($amount, '100', 0);

        $resp = $builder->chain('v3/pay/transactions/native')->post([
            'json' => [
                'mchid'        => $cfg['mchid'],
                'appid'        => $cfg['app_id'],
                'description'  => self::sanitizeDescription($description),
                'out_trade_no' => $orderNo,
                'notify_url'   => $notifyUrl,
                'amount'       => [
                    'total'    => $totalCents,
                    'currency' => $currency,
                ],
                'time_expire'  => $expiresAt->format('Y-m-d\TH:i:sP'),
            ],
        ]);

        $body = json_decode((string) $resp->getBody(), true);
        $codeUrl = $body['code_url'] ?? null;
        if (!$codeUrl) {
            throw new \RuntimeException('微信下单返回缺少 code_url: ' . json_encode($body, JSON_UNESCAPED_UNICODE));
        }
        return $codeUrl;
    }

    /**
     * 微信支付 description 按字节限制 127（不是字符），并过滤控制字符 / 双引号 / 反斜杠。
     */
    private static function sanitizeDescription(string $raw): string
    {
        $clean = preg_replace('/[\x00-\x1F\x7F]/u', '', $raw) ?? '';
        $clean = str_replace(['\\', '"'], '', $clean);
        return mb_strcut($clean, 0, 127, 'UTF-8');
    }

    /** 关单（用户取消 / 关闭过期订单时调用）。 */
    public function closeOrder(string $orderNo): void
    {
        $builder = $this->builder();
        $cfg = $this->loadConfig();

        $builder->chain('v3/pay/transactions/out-trade-no/{out_trade_no}/close')->post([
            'out_trade_no' => $orderNo,
            'json' => ['mchid' => $cfg['mchid']],
        ]);
    }

    /** 查单：用于管理端「同步状态」按钮，容灾场景手动拉取订单状态。 */
    public function queryOrder(string $orderNo): array
    {
        $builder = $this->builder();
        $cfg = $this->loadConfig();

        $resp = $builder->chain('v3/pay/transactions/out-trade-no/{out_trade_no}')->get([
            'out_trade_no' => $orderNo,
            'query' => ['mchid' => $cfg['mchid']],
        ]);
        return json_decode((string) $resp->getBody(), true) ?: [];
    }

    /**
     * 验签 + 解密回调。失败抛异常，外层 Controller 应据此返回 401/500。
     *
     * @return array 解密后的 transaction 报文（数组）
     */
    public function verifyAndDecryptNotify(Request $request): array
    {
        $body = $request->getContent();
        $timestamp = (string) $request->header('Wechatpay-Timestamp', '');
        $nonce = (string) $request->header('Wechatpay-Nonce', '');
        $signature = (string) $request->header('Wechatpay-Signature', '');
        $headerSerial = (string) $request->header('Wechatpay-Serial', '');

        if ($timestamp === '' || $nonce === '' || $signature === '' || $headerSerial === '' || $body === '') {
            throw new \RuntimeException('回调缺少必要 header 或 body');
        }

        // 5 分钟时间戳窗口，防重放
        if (abs(time() - (int) $timestamp) > 300) {
            throw new \RuntimeException('回调时间戳超出允许范围');
        }

        $cfg = $this->loadConfig();

        if ($this->usePublicKeyMode()) {
            if (strcasecmp($headerSerial, $cfg['pub_key_id']) !== 0) {
                throw new \RuntimeException(sprintf(
                    '微信支付公钥 ID 不匹配（本地 %s / 回调 %s），请检查后台「微信支付公钥 ID」配置',
                    $cfg['pub_key_id'],
                    $headerSerial
                ));
            }
            $publicKey = Rsa::from($cfg['pub_key'], Rsa::KEY_TYPE_PUBLIC);
        } else {
            $localSerial = $this->platformCertSerial();
            if ($localSerial !== '' && strcasecmp($headerSerial, $localSerial) !== 0) {
                throw new \RuntimeException(sprintf(
                    '微信平台证书序列号不匹配（本地 %s / 回调 %s），请更新后台「微信平台证书」或升级到公钥模式',
                    $localSerial,
                    $headerSerial
                ));
            }
            if ($cfg['platform_cert'] === '') {
                throw new \RuntimeException('微信验签材料未配置（需填入「微信支付公钥」或「平台证书」中的一种）');
            }
            $publicKey = Rsa::from($cfg['platform_cert'], Rsa::KEY_TYPE_PUBLIC);
        }

        $message = $timestamp . "\n" . $nonce . "\n" . $body . "\n";
        $verified = Rsa::verify($message, $signature, $publicKey);
        if (!$verified) {
            throw new \RuntimeException('回调验签失败');
        }

        $payload = json_decode($body, true);
        if (!is_array($payload) || empty($payload['resource'])) {
            throw new \RuntimeException('回调报文格式异常');
        }
        $res = $payload['resource'];
        $apiv3Key = $cfg['apiv3_key'];
        if ($apiv3Key === '') {
            throw new \RuntimeException('APIv3 密钥未配置');
        }

        $plaintext = AesGcm::decrypt(
            (string) ($res['ciphertext'] ?? ''),
            $apiv3Key,
            (string) ($res['nonce'] ?? ''),
            (string) ($res['associated_data'] ?? '')
        );

        $tx = json_decode($plaintext, true);
        if (!is_array($tx)) {
            throw new \RuntimeException('回调解密后 JSON 解析失败');
        }
        return $tx;
    }

    /** 计算微信平台证书序列号（从 PEM 解析）。 */
    public function platformCertSerial(): string
    {
        if ($this->cachedPlatformSerial !== null) {
            return $this->cachedPlatformSerial;
        }
        $platformPem = $this->loadConfig()['platform_cert'];
        if ($platformPem === '') {
            return '';
        }
        try {
            $resource = openssl_x509_read($platformPem);
            if ($resource === false) {
                return '';
            }
            $info = openssl_x509_parse($resource);
            $serialHex = '';
            if (isset($info['serialNumberHex'])) {
                $serialHex = strtoupper((string) $info['serialNumberHex']);
            } elseif (isset($info['serialNumber'])) {
                $serialHex = strtoupper(self::decToHex((string) $info['serialNumber']));
            }
            return $this->cachedPlatformSerial = $serialHex;
        } catch (\Throwable $e) {
            Log::warning('[wxpay] parse platform cert serial failed: ' . $e->getMessage());
            return '';
        }
    }

    /** 装配 Builder（懒加载 + 实例缓存）。 */
    private function builder(): BuilderChainable
    {
        if ($this->cachedBuilder !== null) {
            return $this->cachedBuilder;
        }
        if (!$this->isConfigured()) {
            throw new \RuntimeException('微信支付未配置完整');
        }

        $cfg = $this->loadConfig();

        if ($this->usePublicKeyMode()) {
            $certs = [
                $cfg['pub_key_id'] => Rsa::from($cfg['pub_key'], Rsa::KEY_TYPE_PUBLIC),
            ];
        } else {
            $platformSerial = $this->platformCertSerial();
            if ($platformSerial === '') {
                throw new \RuntimeException('解析微信平台证书序列号失败，请检查证书 PEM 格式或升级到公钥模式');
            }
            $certs = [
                $platformSerial => Rsa::from($cfg['platform_cert'], Rsa::KEY_TYPE_PUBLIC),
            ];
        }

        $this->cachedBuilder = Builder::factory([
            'mchid'      => $cfg['mchid'],
            'serial'     => $cfg['cert_serial_no'],
            'privateKey' => Rsa::from($cfg['private_key'], Rsa::KEY_TYPE_PRIVATE),
            'certs'      => $certs,
        ]);

        return $this->cachedBuilder;
    }

    /** 大整数十进制转十六进制（PHP 内置 dechex 不支持超大数）。 */
    private static function decToHex(string $dec): string
    {
        if (function_exists('gmp_strval')) {
            return gmp_strval($dec, 16);
        }
        $hex = '';
        while (bccomp($dec, '0') > 0) {
            $rem = (int) bcmod($dec, '16');
            $hex = dechex($rem) . $hex;
            $dec = bcdiv($dec, '16', 0);
        }
        return $hex === '' ? '0' : $hex;
    }
}
