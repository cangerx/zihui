<?php

namespace App\Http\Controllers;

use App\Models\SystemSetting;
use App\Services\Sms\AliyunSmsService;
use App\Services\Sms\SmsCodeService;
use App\Services\StorageService;
use App\Services\TianquePayService;
use App\Services\WeChatPayService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

class SettingController extends Controller
{
    public function index(Request $request)
    {
        return response()->json([
            'settings'     => SystemSetting::getAll(),
            'allowed_keys' => array_keys(SystemSetting::ALLOWED_KEYS),
            // 运行时拼接的微信回调 URL，随当前请求域名变化，便于多套部署
            'wxpay_notify_url_runtime' => rtrim($request->getSchemeAndHttpHost(), '/') . '/api/payment/wechat/notify',
        ]);
    }

    /**
     * 公开站点配置（不需登录）。
     * 暴露给桌面端 / Web 客户端启动时拉取的少量必要配置：
     * - currency.token：现金钱包 (balance_type='token') 的显示文案，默认"金币"
     * - currency.credit：积分钱包 (balance_type='credit') 的显示文案，默认"积分"
     *
     * 故意只暴露白名单字段，避免敏感配置（微信支付密钥等）泄露。
     */
    public function publicConfig(Request $request)
    {
        return response()->json([
            'currency' => [
                'token'  => (string) SystemSetting::getValue('currency_label_token', '金币'),
                'credit' => (string) SystemSetting::getValue('currency_label_credit', '积分'),
            ],
            'site' => [
                'title' => (string) SystemSetting::getValue('site_title', 'Agent Admin'),
                'product_name' => (string) SystemSetting::getValue('cloud_build_app_name', ''),
            ],
            // 支付通道开关：仅暴露布尔，不暴露任何密钥/证书。
            // 桌面端用此控制 PaymentDialog 显示哪些支付方式按钮。
            'payment' => [
                'wechat'   => (bool) SystemSetting::getValue('wxpay_enabled', false),
                'tianque'  => (bool) SystemSetting::getValue('tianque_enabled', false),
                'xunhupay' => (bool) SystemSetting::getValue('xunhupay_enabled', false),
            ],
            // 桌面端功能显示开关：ai_mark_removal=是否对所有用户显示「去AI标记」入口；
            // ai_mark_removal_use_all=是否全局可用（免逐个授权，仅影响能否使用不影响显示）
            'features' => [
                'ai_mark_removal'         => (bool) SystemSetting::getValue('ai_mark_removal_enabled', false),
                'ai_mark_removal_use_all' => (bool) SystemSetting::getValue('ai_mark_removal_use_all', false),
            ],
            'register' => [
                'enabled' => (bool) SystemSetting::getValue('register_enabled', true),
                // 注册短信验证：需短信总开关 + 注册短信验证开关同时开启，桌面端据此决定是否显示验证码输入
                'sms_verify_enabled' => (bool) SystemSetting::getValue('sms_enabled', false)
                    && (bool) SystemSetting::getValue('register_sms_verify_enabled', false),
            ],
            // 找回密码：需短信总开关 + 找回密码开关同时开启，桌面端据此决定是否显示「忘记密码」入口
            'forgot_password' => [
                'enabled' => (bool) SystemSetting::getValue('sms_enabled', false)
                    && (bool) SystemSetting::getValue('forgot_password_enabled', false),
            ],
            // 桌面端入口开关：套餐商城 + 分类型充值（关闭后桌面端用户中心隐藏对应入口）
            'plans_store' => [
                'enabled' => (bool) SystemSetting::getValue('plans_store_enabled', true),
            ],
            'recharge' => [
                'enabled' => (bool) SystemSetting::getValue('recharge_enabled', false),
                'token'   => (bool) SystemSetting::getValue('recharge_token_enabled', true),
                'credit'  => (bool) SystemSetting::getValue('recharge_credit_enabled', true),
            ],
            // 桌面端注册页协议（标题 + HTML 内容），桌面端弹窗渲染前要 sanitize
            'agreements' => [
                'register' => [
                    'title'   => (string) SystemSetting::getValue('register_agreement_title', '注册协议'),
                    'content' => (string) SystemSetting::getValue('register_agreement_content', ''),
                ],
                'privacy' => [
                    'title'   => (string) SystemSetting::getValue('privacy_agreement_title', '隐私协议'),
                    'content' => (string) SystemSetting::getValue('privacy_agreement_content', ''),
                ],
            ],
            // 桌面端「对话页面默认模型」：新建会话时填入 conversation.active_model_*；
            // - provider 通常为 'cloud:default'（云端虚拟服务商），model_id 是云模型表里的 model_id（裸值）
            // - 留空表示未配置，桌面端会回退到本地第一个 chat 类型模型
            'chat_default_model' => [
                'provider_id' => (string) SystemSetting::getValue('chat_default_model_provider', 'cloud:default'),
                'model_id'    => (string) SystemSetting::getValue('chat_default_model_id', ''),
            ],
            // 登录页背景图（桌面端登录页全屏背景；空=桌面端用内置品牌橙光晕兜底）
            'login_background' => [
                'url' => (string) SystemSetting::getValue('login_background_url', ''),
            ],
            // 智能体列表页背景图（桌面端首页=/bots 整页 cover 背景；空=默认纯色）
            'bot_list_background' => [
                'url' => (string) SystemSetting::getValue('bot_list_background_url', ''),
            ],
            // 全局主题主色（hex，桌面端据此派生整套色阶换肤；空=桌面端用内置默认橙）
            'theme' => [
                'primary_color' => (string) SystemSetting::getValue('theme_primary_color', ''),
            ],
            'customer_service' => $this->customerServiceConfig($request),
        ]);
    }

    private function customerServiceConfig(Request $request): ?array
    {
        $projectKey = trim((string) $request->header('X-OEM-Project-Key', ''));
        if ($projectKey !== '') {
            $project = DB::table('oem_projects')
                ->where('project_key', $projectKey)
                ->where('status', 'active')
                ->whereNull('deleted_at')
                ->first();
            if (!$project) {
                return null;
            }
            return $this->customerServicePayload(
                (string) ($project->customer_service_title ?? ''),
                (string) ($project->customer_service_image_url ?? ''),
                'oem',
                $projectKey
            );
        }

        return $this->customerServicePayload(
            (string) SystemSetting::getValue('cloud_build_customer_service_title', ''),
            (string) SystemSetting::getValue('cloud_build_customer_service_image_url', ''),
            'cloud_build',
            null
        );
    }

    private function customerServicePayload(string $title, string $imageUrl, string $source, ?string $projectKey): ?array
    {
        $title = trim($title);
        $imageUrl = trim($imageUrl);
        if ($title === '' || $imageUrl === '') {
            return null;
        }
        return [
            'title' => $title,
            'image_url' => $imageUrl,
            'source' => $source,
            'project_key' => $projectKey,
        ];
    }

    public function update(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'settings' => 'present|array',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $settings = $request->input('settings', []);

        // 入库前预校验：天阙私钥若有传入，立即用 OpenSSL 加载验证；
        // 失败立即拒绝并返回详细诊断（含非法字符位置 / OpenSSL 错误），
        // 避免污染数据落库后等到测试阶段才发现"未知 OpenSSL 错误"。
        if (
            isset($settings['tianque_private_key'])
            && is_string($settings['tianque_private_key'])
            && $settings['tianque_private_key'] !== ''
        ) {
            try {
                TianquePayService::validatePrivateKey($settings['tianque_private_key']);
            } catch (\RuntimeException $e) {
                return response()->json(['error' => $e->getMessage()], 422);
            }
        }

        // 入库前预校验：天阙平台公钥若有传入，立即用 OpenSSL 加载验证；
        // 失败立即拒绝并返回详细诊断（含非法字符位置 / OpenSSL 错误），
        // 与私钥同样的污染清洗 + 包装尝试 + 友好错误信息。
        if (
            isset($settings['tianque_public_key'])
            && is_string($settings['tianque_public_key'])
            && $settings['tianque_public_key'] !== ''
        ) {
            try {
                TianquePayService::validatePublicKey($settings['tianque_public_key']);
            } catch (\RuntimeException $e) {
                return response()->json(['error' => $e->getMessage()], 422);
            }
        }

        $updated = [];
        foreach ($settings as $key => $value) {
            if (!array_key_exists($key, SystemSetting::ALLOWED_KEYS)) continue;
            // 加密字段 + 关键存储凭据留空表示不修改（保持原值），避免前端只要打开表单就覆盖为空
            if (($value === '' || $value === null) && SystemSetting::skipEmptyUpdate($key)) {
                continue;
            }
            SystemSetting::setValue($key, $value);
            $updated[] = $key;
        }

        return response()->json([
            'updated'  => $updated,
            'settings' => SystemSetting::getAll(),
            'wxpay_notify_url_runtime' => rtrim($request->getSchemeAndHttpHost(), '/') . '/api/payment/wechat/notify',
        ]);
    }

    /**
     * 测试微信支付配置是否完整可用：
     * - 必填字段齐备
     * - 平台证书模式：能解析出证书序列号；公钥模式：跳过此步
     * - SDK Builder 能装配成功（验证私钥、验签材料格式有效）
     *
     * 返回字段 `mode` 标识当前生效模式：public_key（推荐） / platform_cert（兼容）
     */
    public function wxpayTest(WeChatPayService $wxpay)
    {
        if (!$wxpay->isConfigured()) {
            return response()->json(['ok' => false, 'error' => '微信支付配置不完整，请检查各必填项'], 400);
        }

        $usePubKey = $wxpay->usePublicKeyMode();
        $platformSerial = '';

        // 仅平台证书模式需要解析证书序列号；公钥模式 pub_key_id 直接来自配置无需解析
        if (!$usePubKey) {
            $platformSerial = $wxpay->platformCertSerial();
            if ($platformSerial === '') {
                return response()->json(['ok' => false, 'error' => '解析微信平台证书序列号失败，请检查证书 PEM 格式'], 400);
            }
        }

        try {
            // 调用一次不存在订单查询，只验证 SDK 能走通。存在/不存在都不实际影响，只要没有认证错误即可
            $wxpay->queryOrder('payment_test_dry_run_' . time());
        } catch (\Throwable $e) {
            // "订单不存在"（HTTP 404 / ORDER_NOT_EXIST）也是预期的，表示走到业务层了
            $msg = $e->getMessage();
            if (stripos($msg, 'ORDER_NOT_EXIST') !== false || stripos($msg, '404') !== false) {
                return response()->json([
                    'ok'   => true,
                    'mode' => $usePubKey ? 'public_key' : 'platform_cert',
                    'platform_cert_serial' => $platformSerial,  // 公钥模式时为空字符串
                    'note' => '配置已走通（查到 ORDER_NOT_EXIST 表示认证成功）',
                ]);
            }
            return response()->json(['ok' => false, 'error' => '测试失败：' . $msg], 502);
        }
        return response()->json([
            'ok'   => true,
            'mode' => $usePubKey ? 'public_key' : 'platform_cert',
            'platform_cert_serial' => $platformSerial,
        ]);
    }

    /**
     * 测试腾讯云 COS 配置：HEAD bucket 验证 SecretId/SecretKey/Region/Bucket 是否正确
     * 返回 200 表示配置正确；403/404 分别为签名错误/Bucket 不存在
     */
    public function cosTest()
    {
        $result = StorageService::testCos();
        if ($result['ok'] ?? false) {
            return response()->json(['ok' => true]);
        }
        return response()->json(['ok' => false, 'error' => $result['error'] ?? '测试失败'], 400);
    }

    /**
     * 测试阿里云 OSS 配置：HEAD bucket 验证 AccessKeyId/AccessKeySecret/Endpoint/Bucket 是否正确
     * 返回 200 表示配置正确；403/404 分别为签名错误/Bucket 不存在
     */
    public function ossTest()
    {
        $result = StorageService::testOss();
        if ($result['ok'] ?? false) {
            return response()->json(['ok' => true]);
        }
        return response()->json(['ok' => false, 'error' => $result['error'] ?? '测试失败'], 400);
    }

    /**
     * 发送测试短信：用当前已保存的短信配置向指定手机号发一条验证码短信，
     * 验证 AccessKey / 签名 / 模板是否可用。会真实消耗短信额度，路由已加严格限流。
     * 直连 AliyunSmsService，不走验证码缓存与每日限流（测试不应占用用户额度）。
     */
    public function smsTest(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'mobile' => 'required|string',
        ], [
            'mobile.required' => '请输入接收测试短信的手机号',
        ]);
        if ($validator->fails()) {
            return response()->json(['ok' => false, 'error' => $validator->errors()->first()], 422);
        }

        $mobile = trim((string) $request->mobile);
        if (!SmsCodeService::isMobile($mobile)) {
            return response()->json(['ok' => false, 'error' => '手机号格式不正确'], 422);
        }
        if (!SystemSetting::getValue('sms_enabled', false)) {
            return response()->json(['ok' => false, 'error' => '请先开启并保存短信服务配置'], 400);
        }

        $templateCode = (string) SystemSetting::getValue('sms_template_code', '');
        $code = (string) random_int(100000, 999999);
        $result = app(AliyunSmsService::class)->send($mobile, $templateCode, ['code' => $code]);

        if ($result['ok'] ?? false) {
            return response()->json(['ok' => true, 'message' => '测试短信已发送，请查收']);
        }
        return response()->json(['ok' => false, 'error' => $result['message'] ?? '发送失败'], 400);
    }
}
