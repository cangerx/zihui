<?php

namespace App\Services;

use App\Models\PaymentOrder;
use App\Models\SystemSetting;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * 天阙支付服务（聚合支付：微信/支付宝/云闪付/数字人民币）
 *
 * 仅实现「主扫预下单」+「订单查询」，与微信 Native 用户体验对齐：
 *   - 用户在桌面端扫描二维码 → 在自己手机上完成支付
 *   - 因天阙未提供异步通知，需客户端轮询 sync 接口主动同步状态
 *
 * 签名规范（严格遵循官方）：
 *   - 算法：SHA1withRSA + Base64
 *   - 私钥：PKCS8 格式
 *   - 外层参数按 key 字典序排序（sign 字段除外）
 *   - reqData 内部 **不排序**，保持代码定义顺序
 *   - JSON 紧凑无空格、中文不转义
 *   - amt 必须是字符串类型（"0.01" 而非 0.01）
 *
 * 响应验签：使用代码内置的天阙公钥（测试/生产各一个），防止响应被篡改。
 */
class TianquePayService
{
    /** 测试环境 API 域名 */
    private const URL_TEST = 'https://openapi-test.tianquetech.com';

    /** 生产环境 API 域名 */
    private const URL_PROD = 'https://openapi.tianquetech.com';

    /**
     * 天阙官方公钥（测试环境）— 来自 skill 文档，固定值。
     * 用于验证天阙响应的签名，防止响应被中间人篡改。
     */
    private const PUB_KEY_TEST = 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCOmsrFtFPTnEzfpJ/hDl5RODBxw4i9Ex3NmmG/N7A1+by032zZZgLLpdNh8y5otjFY0E37Nyr4FGKFRSSuDiTk8vfx3pv6ImS1Rxjjg4qdVHIfqhCeB0Z2ZPuBD3Gbj8hHFEtXZq8+msAFu/5ZQjiVhgs5WWBjh54LYWSum+d9+wIDAQAB';

    /** 天阙官方公钥（生产环境）— 来自 skill 文档，固定值。 */
    private const PUB_KEY_PROD = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjo1+KBcvwDSIo+nMYLeOJ19Ju4ii0xH66ZxFd869EWFWk/EJa3xIA2+4qGf/Ic7m7zi/NHuCnfUtUDmUdP0JfaZiYwn+1Ek7tYAOc1+1GxhzcexSJLyJlR2JLMfEM+rZooW4Ei7q3a8jdTWUNoak/bVPXnLEVLrbIguXABERQ0Ze0X9Fs0y/zkQFg8UjxUN88g2CRfMC6LldHm7UBo+d+WlpOYH7u0OTzoLLiP/04N1cfTgjjtqTBI7qkOGxYs6aBZHG1DJ6WdP+5w+ho91sBTVajsCxAaMoExWQM2ipf/1qGdsWmkZScPflBqg7m0olOD87ymAVP/3Tcbvi34bDfwIDAQAB';

    private ?array $cachedConfig = null;

    /**
     * 一次性装载天阙支付配置。同一请求生命周期缓存。
     *
     * @return array{enabled: bool, env: string, version: string, org_id: string, mno: string, private_key: string, public_key: string}
     */
    public function loadConfig(): array
    {
        if ($this->cachedConfig !== null) return $this->cachedConfig;

        $settings = SystemSetting::getAll();
        return $this->cachedConfig = [
            'enabled'     => !empty($settings['tianque_enabled']),
            'env'         => (string)($settings['tianque_env'] ?? 'test'),
            'version'     => (string)($settings['tianque_version'] ?? '1.2'),
            'org_id'      => (string)($settings['tianque_org_id'] ?? ''),
            'mno'         => (string)($settings['tianque_mno'] ?? ''),
            'private_key' => (string)SystemSetting::getRawValue('tianque_private_key', ''),
            'public_key'  => (string)($settings['tianque_public_key'] ?? ''),
        ];
    }

    /**
     * 配置是否齐全。Controller 创建订单前先校验。
     */
    public function isConfigured(): bool
    {
        $cfg = $this->loadConfig();
        if (!$cfg['enabled']) return false;
        foreach (['env', 'version', 'org_id', 'mno', 'private_key'] as $k) {
            if ($cfg[$k] === '') return false;
        }
        return in_array($cfg['env'], ['test', 'prod'], true)
            && in_array($cfg['version'], ['1.0', '1.2'], true);
    }

    /**
     * 主扫预下单（POST /order/activePlusScan）：返回 payUrl 二维码内容。
     *
     * @param PaymentOrder $order  订单（amount / order_no / currency 等）
     * @param string       $description 商品描述（≤256 字节）
     * @param string       $clientIp    用户终端 IP（≤16 位字符）
     * @return array{payUrl: string, uuid: string, sxfUuid: string}
     */
    public function nativePrepay(PaymentOrder $order, string $description, string $clientIp): array
    {
        // ⚠️ amt 必须是字符串类型，2 位小数；reqData 字段顺序保持代码定义顺序
        $reqData = [
            'mno'     => $this->loadConfig()['mno'],
            'ordNo'   => $order->order_no,
            'amt'     => number_format((float)$order->amount, 2, '.', ''),
            'subject' => self::sanitizeSubject($description),
            'trmIp'   => $clientIp !== '' ? mb_substr($clientIp, 0, 16) : '127.0.0.1',
        ];

        $resp = $this->postJson('/order/activePlusScan', $reqData);

        $payUrl = (string)($resp['payUrl'] ?? '');
        if ($payUrl === '') {
            throw new \RuntimeException('天阙下单返回缺少 payUrl');
        }
        return [
            'payUrl'  => $payUrl,
            'uuid'    => (string)($resp['uuid'] ?? ''),
            'sxfUuid' => (string)($resp['sxfUuid'] ?? ''),
        ];
    }

    /**
     * 订单查询（POST /query/tradeQuery）：返回 tranSts + 流水号等。
     *
     * @return array 业务字段：tranSts, ordNo, uuid, payTime, transactionId, sxfUuid
     */
    public function queryOrder(string $orderNo): array
    {
        $reqData = [
            'mno'   => $this->loadConfig()['mno'],
            'ordNo' => $orderNo,
        ];
        return $this->postJson('/query/tradeQuery', $reqData);
    }

    /**
     * 发送 POST JSON 请求 + 验签响应。
     *
     * @return array respData（业务字段，已剥离外层包装）
     * @throws \RuntimeException 接口失败、签名失败或验签失败
     */
    private function postJson(string $path, array $reqData): array
    {
        if (!$this->isConfigured()) {
            throw new \RuntimeException('天阙支付未配置完整');
        }

        $cfg = $this->loadConfig();
        $baseUrl = $cfg['env'] === 'prod' ? self::URL_PROD : self::URL_TEST;

        $params = [
            'signType'  => 'RSA',
            'version'   => $cfg['version'],
            'orgId'     => $cfg['org_id'],
            'reqId'     => self::generateReqId(),
            'timestamp' => date('YmdHis'),
            'reqData'   => $reqData,
        ];
        $params['sign'] = $this->sign($params, $cfg['private_key']);

        try {
            $response = Http::asJson()
                ->timeout(15)
                ->connectTimeout(5)
                ->post($baseUrl . $path, $params);
        } catch (\Throwable $e) {
            throw new \RuntimeException('天阙接口连接失败：' . $e->getMessage());
        }

        if (!$response->successful()) {
            throw new \RuntimeException('天阙接口 HTTP 错误：' . $response->status());
        }

        $body = $response->json();
        if (!is_array($body)) {
            throw new \RuntimeException('天阙响应格式异常');
        }

        // 接口应答码（code）：0000 表示接口调用成功
        $code = (string)($body['code'] ?? '');
        if ($code !== '0000') {
            throw new \RuntimeException(sprintf(
                '天阙接口失败 code=%s msg=%s',
                $code,
                (string)($body['msg'] ?? '')
            ));
        }

        // 验签：防止响应被篡改。优先用商户配置的平台公钥，未配置时回退代码内置默认公钥
        if (!$this->verifyResponse($body, $cfg['env'], $cfg['public_key'])) {
            throw new \RuntimeException('天阙响应验签失败');
        }

        // 业务应答码（bizCode）：在 respData 内
        $respData = (array)($body['respData'] ?? []);
        $bizCode = (string)($respData['bizCode'] ?? '');
        if ($bizCode !== '0000' && $bizCode !== '2002') {
            // 2002 = 支付中需轮询，不算失败；其余非 0000 都视为业务错误
            throw new \RuntimeException(sprintf(
                '天阙业务失败 bizCode=%s bizMsg=%s',
                $bizCode,
                (string)($respData['bizMsg'] ?? '')
            ));
        }
        return $respData;
    }

    /**
     * 计算签名（SHA1withRSA + Base64）。
     *
     * 关键规则：
     *   - 外层参数按 key 字典序排序
     *   - reqData 字段保持代码定义顺序，json_encode 不转义中文、不加空格
     *   - 跳过 sign 字段、null、空字符串（保留 0 / 'false' 等）
     */
    private function sign(array $params, string $privateKeyPem): string
    {
        $signString = $this->buildSignString($params);
        $pkey = self::loadPrivateKey($privateKeyPem);
        $sig = '';
        if (!openssl_sign($signString, $sig, $pkey, OPENSSL_ALGO_SHA1)) {
            throw new \RuntimeException('天阙签名失败：' . openssl_error_string());
        }
        return base64_encode($sig);
    }

    /**
     * 验签响应（必做）：优先用商户配置的平台公钥校验，未配置时回退代码内置默认公钥。
     *
     * 平台公钥来源：天阙商户后台「密钥管理 / 平台公钥下载」。天阙的平台公钥
     * 一般按测试 / 生产环境各一份对所有商户固定，代码内置作为保底；若天阙日后轮换公钥，
     * 运维可在管理后台「天阙支付 → 平台公钥」自助更新，无需重新部署。
     */
    private function verifyResponse(array $response, string $env, string $configPubKeyPem = ''): bool
    {
        $sign = (string)($response['sign'] ?? '');
        if ($sign === '') {
            // 部分接口可能无 sign 字段，按官方约定记 warning 后放行
            Log::warning('[tianque] response missing sign field');
            return true;
        }

        $signString = $this->buildSignString($response);

        // 优先用商户配置的平台公钥；未配置时回退代码内置默认公钥。
        // 配置公钥走 loadPublicKey 的污染清洗 + 多格式包装尝试路径，内置默认公钥是干净常量直接加载。
        if ($configPubKeyPem !== '') {
            $pubKey = self::loadPublicKey($configPubKeyPem);
        } else {
            $pubKeyPem = "-----BEGIN PUBLIC KEY-----\n"
                . self::wrapBase64($env === 'prod' ? self::PUB_KEY_PROD : self::PUB_KEY_TEST)
                . "\n-----END PUBLIC KEY-----";
            $pubKey = openssl_pkey_get_public($pubKeyPem);
            if (!$pubKey) {
                throw new \RuntimeException('天阙内置默认公钥加载失败：' . openssl_error_string());
            }
        }
        $verified = openssl_verify($signString, base64_decode($sign), $pubKey, OPENSSL_ALGO_SHA1);
        return $verified === 1;
    }

    /**
     * 构造签名字符串：外层 key 字典序，reqData 内部保持原顺序，紧凑 JSON 不转义中文。
     */
    private function buildSignString(array $params): string
    {
        // 过滤：跳过 sign / null / 空字符串
        $filtered = [];
        foreach ($params as $k => $v) {
            if ($k === 'sign') continue;
            if ($v === null || $v === '') continue;
            $filtered[$k] = $v;
        }
        // 外层 key 字典序
        ksort($filtered, SORT_STRING);

        $parts = [];
        foreach ($filtered as $k => $v) {
            if (is_array($v)) {
                // ⚠️ JSON_UNESCAPED_UNICODE 保留中文原字符，JSON_UNESCAPED_SLASHES 不转义斜杠
                // 不传 JSON_PRETTY_PRINT，PHP json_encode 默认无空格无换行
                $v = json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            }
            $parts[] = "{$k}={$v}";
        }
        return implode('&', $parts);
    }

    /**
     * 校验私钥可被加载（设置入库前的预校验）。失败抛 RuntimeException 含详细诊断信息。
     */
    public static function validatePrivateKey(string $key): bool
    {
        self::loadPrivateKey($key);
        return true;
    }

    /**
     * 校验平台公钥可被加载（设置入库前的预校验）。失败抛 RuntimeException 含详细诊断信息。
     */
    public static function validatePublicKey(string $key): bool
    {
        self::loadPublicKey($key);
        return true;
    }

    /**
     * 加载平台公钥，兼容三种输入并自动 normalize：
     *   - PKCS#8 SubjectPublicKeyInfo PEM 文本（含 -----BEGIN PUBLIC KEY-----，天阙官方格式）
     *   - PKCS#1 RSA PEM 文本（含 -----BEGIN RSA PUBLIC KEY-----）
     *   - 纯 base64 字符串（无 PEM 头）
     *
     * 复用与 loadPrivateKey 一致的污染清洗 + 包装尝试 + 错误诊断流程。
     */
    private static function loadPublicKey(string $key): \OpenSSLAsymmetricKey
    {
        $body = self::normalizePublicKeyBody($key);
        $bodyLen = strlen($body);

        // PKCS#8 SubjectPublicKeyInfo 优先（天阙官方格式）
        $tryOrder = ['PUBLIC KEY', 'RSA PUBLIC KEY'];

        $errors = [];
        foreach ($tryOrder as $headerType) {
            $pem = self::buildPem($body, $headerType);

            // 清空 OpenSSL 错误队列，避免本次结果被前一次污染
            while (openssl_error_string() !== false) {}

            $pkey = openssl_pkey_get_public($pem);
            if ($pkey) {
                return $pkey;
            }

            $thisErrs = [];
            while (($e = openssl_error_string()) !== false) {
                $thisErrs[] = $e;
            }
            $errors[] = sprintf(
                '[%s] %s',
                $headerType,
                $thisErrs ? implode(' / ', $thisErrs) : '无错误队列输出'
            );
        }

        $errMsg = implode('; ', $errors);
        $diag = sprintf(
            '（base64 体 %d 字节，已尝试: %s，OpenSSL %s）',
            $bodyLen,
            implode(' → ', $tryOrder),
            OPENSSL_VERSION_TEXT
        );

        throw new \RuntimeException(
            '天阙平台公钥加载失败：' . $errMsg . $diag
            . '。请从天阙商户平台「密钥管理 / 平台公钥下载」重新获取公钥。'
            . '受支持的格式：(1) PKCS#8 PEM（-----BEGIN PUBLIC KEY-----，推荐）；'
            . '(2) PKCS#1 PEM（-----BEGIN RSA PUBLIC KEY-----）；'
            . '(3) 纯 base64 字符串（无 PEM 头，自动包装）'
        );
    }

    /**
     * 把任意形式的公钥输入归一化为干净的 base64 体（不含 PEM 头尾、不含任何空白）。
     *
     * 复用与 normalizePrivateKeyBody 一致的污染清洗逻辑，但识别误粘贴的对象不同：
     *   - 误粘贴私钥 → 友好报错
     *   - 误粘贴证书 → 友好报错
     */
    private static function normalizePublicKeyBody(string $key): string
    {
        // 0. 检测误粘贴了私钥或证书
        if (preg_match('/-----BEGIN\s+(RSA\s+)?(ENCRYPTED\s+)?PRIVATE\s+KEY-----/u', $key)) {
            throw new \RuntimeException(
                '天阙平台公钥格式错误：粘贴的是私钥，不是公钥。请从天阙商户平台「密钥管理 / 平台公钥下载」获取平台公钥'
            );
        }
        if (preg_match('/-----BEGIN\s+CERTIFICATE-----/u', $key)) {
            throw new \RuntimeException(
                '天阙平台公钥格式错误：粘贴的是证书，不是公钥。请从天阙商户平台「密钥管理 / 平台公钥下载」获取平台公钥'
            );
        }

        // 1. 剥离所有 PEM 头尾行，只保留 base64 体
        $body = preg_replace(
            '/-----\s*(BEGIN|END)[A-Z\s]+-----/u',
            '',
            $key
        ) ?? '';

        // 2. 彻底清除所有空白和 Unicode 不可见字符
        $body = preg_replace(
            '/[\s\x{00A0}\x{200B}\x{200C}\x{200D}\x{2060}\x{3000}\x{FEFF}\x{0000}-\x{001F}\x{007F}]+/u',
            '',
            $body
        ) ?? '';

        if ($body === '') {
            throw new \RuntimeException(
                '天阙平台公钥内容为空。请检查表单是否成功保存，或重新从天阙商户平台导出公钥粘贴'
            );
        }

        // 3. 预校验 base64 字符集（A-Z a-z 0-9 + / =）
        if (!preg_match('/^[A-Za-z0-9+\/=]+$/', $body)) {
            $badChar = '?';
            $badCode = 0;
            $len = mb_strlen($body, 'UTF-8');
            for ($i = 0; $i < $len; $i++) {
                $ch = mb_substr($body, $i, 1, 'UTF-8');
                if (!preg_match('/^[A-Za-z0-9+\/=]$/', $ch)) {
                    $badChar = $ch;
                    $badCode = function_exists('mb_ord') ? (mb_ord($ch, 'UTF-8') ?: 0) : 0;
                    break;
                }
            }
            throw new \RuntimeException(sprintf(
                '天阙平台公钥含非 base64 字符："%s" (U+%04X)。常见原因：粘贴时混入中文破折号 "——"、'
                . '全角字符、特殊符号或不可见字符。请直接在天阙商户平台导出公钥文件后用文本编辑器'
                . '打开复制粘贴，避免经过微信 / PDF / Word 等中转工具',
                $badChar,
                $badCode
            ));
        }

        return $body;
    }

    /**
     * 加载私钥，兼容三种输入并自动 normalize：
     *   - PKCS8 PEM 文本（含 -----BEGIN PRIVATE KEY-----，天阙官方建议格式）
     *   - PKCS1 PEM 文本（含 -----BEGIN RSA PRIVATE KEY-----）
     *   - 纯 base64 字符串（无 PEM 头，参考随行付/天阙商户后台导出风格）
     *
     * 无论用户输入哪种形式，统一 normalize 流程：
     *   1. 提取 base64 体，剥离所有 BEGIN/END 头尾
     *   2. 清除全部 ASCII 空白 + Unicode 不可见字符（零宽空格、不间断空格、BOM、全角空格等）
     *   3. 校验 base64 字符集（提前识别"中文破折号 / 全角字符"等粘贴污染）
     *   4. 依次按 PKCS8 / PKCS1 包装尝试加载（OpenSSL 3.x 严格区分头部与内容）
     *
     * 这是为了解决用户从微信 / PDF / Word / 网页复制粘贴 PEM 时常见的污染：
     *   - 不可见字符（如 \u200B 零宽空格）混入 base64 体
     *   - PEM 头被替换成视觉相似的中文破折号 "——"
     *   - 换行符丢失或被替换成空格
     * 这些情况下 PHP 8 + OpenSSL 3 会失败但不写错误队列，导致诊断困难。
     */
    private static function loadPrivateKey(string $key): \OpenSSLAsymmetricKey
    {
        [$body, $hintType] = self::normalizePrivateKeyBody($key);
        $bodyLen = strlen($body);

        // 决定尝试顺序：
        //   - 用户已写明 PEM 头 → 该头部优先
        //   - 纯 base64 → 按字节长度推断（RSA 2048 PKCS8 ≈ 1624，PKCS1 ≈ 1592）
        if ($hintType === 'PRIVATE KEY') {
            $tryOrder = ['PRIVATE KEY', 'RSA PRIVATE KEY'];
        } elseif ($hintType === 'RSA PRIVATE KEY') {
            $tryOrder = ['RSA PRIVATE KEY', 'PRIVATE KEY'];
        } else {
            $tryOrder = $bodyLen >= 1610
                ? ['PRIVATE KEY', 'RSA PRIVATE KEY']
                : ['RSA PRIVATE KEY', 'PRIVATE KEY'];
        }

        $errors = [];
        foreach ($tryOrder as $headerType) {
            $pem = self::buildPem($body, $headerType);

            // 清空 OpenSSL 错误队列，避免本次结果被前一次污染
            while (openssl_error_string() !== false) {}

            $pkey = openssl_pkey_get_private($pem);
            if ($pkey) {
                return $pkey;
            }

            // 收集本次尝试的错误
            $thisErrs = [];
            while (($e = openssl_error_string()) !== false) {
                $thisErrs[] = $e;
            }
            $errors[] = sprintf(
                '[%s] %s',
                $headerType,
                $thisErrs ? implode(' / ', $thisErrs) : '无错误队列输出'
            );
        }

        $errMsg = implode('; ', $errors);
        $diag = sprintf(
            '（base64 体 %d 字节，已尝试: %s，OpenSSL %s）',
            $bodyLen,
            implode(' → ', $tryOrder),
            OPENSSL_VERSION_TEXT
        );

        throw new \RuntimeException(
            '天阙私钥加载失败：' . $errMsg . $diag
            . '。受支持的格式：(1) PKCS8 PEM（-----BEGIN PRIVATE KEY-----，推荐）；'
            . '(2) PKCS1 PEM（-----BEGIN RSA PRIVATE KEY-----）；'
            . '(3) 纯 base64 字符串（无 PEM 头，自动包装）。'
            . '请直接在天阙商户平台导出私钥文件后用文本编辑器打开复制粘贴，'
            . '避免经过微信 / PDF / Word 等中转工具'
        );
    }

    /**
     * 把任意形式的私钥输入归一化为干净的 base64 体（不含 PEM 头尾、不含任何空白）。
     *
     * @return array{0: string, 1: ?string} [body, hintType]
     *   - body：纯 base64 字符串
     *   - hintType：用户输入中携带的头部类型（'PRIVATE KEY' / 'RSA PRIVATE KEY'），无则 null
     *
     * @throws \RuntimeException 输入为空 / 含非 base64 字符 / 误粘贴公钥或证书
     */
    private static function normalizePrivateKeyBody(string $key): array
    {
        // 0. 检测误粘贴了加密私钥、公钥或证书
        if (preg_match('/-----BEGIN\s+ENCRYPTED\s+PRIVATE\s+KEY-----/u', $key)) {
            throw new \RuntimeException(
                '天阙私钥格式错误：检测到 ENCRYPTED PRIVATE KEY（加密私钥）。'
                . '请在天阙商户平台导出未加密的私钥（PKCS8 或 PKCS1 格式），不要使用带密码保护的私钥文件'
            );
        }
        if (preg_match('/-----BEGIN\s+(PUBLIC\s+KEY|CERTIFICATE)-----/u', $key)) {
            throw new \RuntimeException(
                '天阙私钥格式错误：粘贴的是公钥或证书，不是私钥。请从天阙商户平台导出私钥文件'
            );
        }

        // 1. 检测用户输入中已有的 PEM 头部类型作为 hint
        $hintType = null;
        if (preg_match('/-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/u', $key, $m)) {
            $hintType = !empty(trim($m[1] ?? '')) ? 'RSA PRIVATE KEY' : 'PRIVATE KEY';
        }

        // 2. 剥离所有 PEM 头尾行，只保留 base64 体
        $body = preg_replace(
            '/-----\s*(BEGIN|END)[A-Z\s]+-----/u',
            '',
            $key
        ) ?? '';

        // 3. 彻底清除所有空白和 Unicode 不可见字符
        //    覆盖：ASCII 空白、零宽空格族、不间断空格、BOM、全角空格、不可见控制字符
        $body = preg_replace(
            '/[\s\x{00A0}\x{200B}\x{200C}\x{200D}\x{2060}\x{3000}\x{FEFF}\x{0000}-\x{001F}\x{007F}]+/u',
            '',
            $body
        ) ?? '';

        if ($body === '') {
            throw new \RuntimeException(
                '天阙私钥内容为空。请检查表单是否成功保存，或重新从天阙商户平台导出私钥粘贴'
            );
        }

        // 4. 预校验 base64 字符集（A-Z a-z 0-9 + / =），提前识别粘贴污染
        if (!preg_match('/^[A-Za-z0-9+\/=]+$/', $body)) {
            // 找出第一个非法字符，给用户具体定位
            $badChar = '?';
            $badCode = 0;
            $len = mb_strlen($body, 'UTF-8');
            for ($i = 0; $i < $len; $i++) {
                $ch = mb_substr($body, $i, 1, 'UTF-8');
                if (!preg_match('/^[A-Za-z0-9+\/=]$/', $ch)) {
                    $badChar = $ch;
                    $badCode = function_exists('mb_ord') ? (mb_ord($ch, 'UTF-8') ?: 0) : 0;
                    break;
                }
            }
            throw new \RuntimeException(sprintf(
                '天阙私钥含非 base64 字符："%s" (U+%04X)。常见原因：粘贴时混入中文破折号 "——"、'
                . '全角字符、特殊符号或不可见字符。请直接在天阙商户平台导出私钥文件后用文本编辑器'
                . '打开复制粘贴，避免经过微信 / PDF / Word 等中转工具。',
                $badChar,
                $badCode
            ));
        }

        return [$body, $hintType];
    }

    /**
     * 用 base64 体 + 头部类型构造干净 PEM（无中间空行、无末尾多余换行）。
     *
     * 注意：不能用 chunk_split，因为它会在末尾追加分隔符，
     * 与拼接的 "\n-----END..." 组合后产生空行，OpenSSL 3.x 严格模式下加载失败
     * 且不写错误队列（产生"未知 OpenSSL 错误"诊断信息）。
     */
    private static function buildPem(string $body, string $headerType): string
    {
        $clean = preg_replace('/\s+/', '', $body) ?? '';
        $lines = $clean === '' ? [] : str_split($clean, 64);
        return "-----BEGIN {$headerType}-----\n"
            . implode("\n", $lines)
            . "\n-----END {$headerType}-----\n";
    }

    /**
     * base64 串按 64 字符换行（用于公钥 PEM 包装）。
     *
     * 与 buildPem 一致使用 str_split 而非 chunk_split，避免末尾追加分隔符
     * 拼接 "\n-----END..." 后产生空行的 bug。
     */
    private static function wrapBase64(string $base64): string
    {
        $clean = preg_replace('/\s+/', '', $base64) ?? '';
        return $clean === '' ? '' : implode("\n", str_split($clean, 64));
    }

    /**
     * 生成 reqId：UUID 去横线，32 位。
     */
    private static function generateReqId(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);  // version 4
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);  // variant
        return bin2hex($bytes);
    }

    /**
     * subject 按字节限制 256，过滤控制字符防 JSON 异常。
     */
    private static function sanitizeSubject(string $raw): string
    {
        $clean = preg_replace('/[\x00-\x1F\x7F]/u', '', $raw) ?? '';
        $clean = str_replace(['\\', '"'], '', $clean);
        return mb_strcut($clean, 0, 256, 'UTF-8');
    }
}
