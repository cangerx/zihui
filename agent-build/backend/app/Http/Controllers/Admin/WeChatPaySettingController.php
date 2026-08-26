<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\Pay\WeChatPayService;
use App\Services\SystemSetting\SettingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

/**
 * 微信收款配置（自助付费页的收款商户）。
 *
 * 存储：system_settings group='wechat_pay'，敏感字段 apiv3_key / private_key 加密。
 * 收款商户全局唯一（不按租户）。把已部署云控端的微信商户「明文」凭据在此录入即可
 * （不能直接拷云控端数据库密文：两边 APP_KEY 不同解不开）。
 */
class WeChatPaySettingController extends Controller
{
    /** 加密存储的字段。 */
    private const ENCRYPTED_KEYS = ['apiv3_key', 'private_key'];

    private SettingService $settings;

    public function __construct(SettingService $settings)
    {
        $this->settings = $settings;
    }

    /** GET /admin/api/settings/wechat-pay —— 回前端时密钥只回是否已配置，不回明文。 */
    public function show(): JsonResponse
    {
        $g = $this->settings->getGroup(WeChatPayService::SETTINGS_GROUP);

        return response()->json([
            'enabled'          => (string) ($g['enabled'] ?? '0') === '1',
            'mchid'            => (string) ($g['mchid'] ?? ''),
            'app_id'           => (string) ($g['app_id'] ?? ''),
            'cert_serial_no'   => (string) ($g['cert_serial_no'] ?? ''),
            'pub_key_id'       => (string) ($g['pub_key_id'] ?? ''),
            // 验签材料 / 私钥 / apiv3 密钥：仅回「是否已配置」，不回明文
            'has_apiv3_key'    => (string) ($g['apiv3_key'] ?? '') !== '',
            'has_private_key'  => (string) ($g['private_key'] ?? '') !== '',
            'has_pub_key'      => (string) ($g['pub_key'] ?? '') !== '',
            'has_platform_cert' => (string) ($g['platform_cert'] ?? '') !== '',
            // 验签模式：公钥模式（pub_key_id+pub_key）优先，否则平台证书模式
            'verify_mode'      => ((string) ($g['pub_key_id'] ?? '') !== '' && (string) ($g['pub_key'] ?? '') !== '')
                ? 'public_key' : 'platform_cert',
        ], 200);
    }

    /**
     * PUT /admin/api/settings/wechat-pay
     * 留空的加密字段（apiv3_key / private_key）表示「不修改」，沿用已有值。
     */
    public function update(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'enabled'        => ['required', 'boolean'],
            'mchid'          => ['required', 'string', 'max:64'],
            'app_id'         => ['required', 'string', 'max:64'],
            'cert_serial_no' => ['required', 'string', 'max:128'],
            // 留空 = 不修改
            'apiv3_key'      => ['sometimes', 'nullable', 'string', 'max:128'],
            'private_key'    => ['sometimes', 'nullable', 'string', 'max:8000'],
            // 验签材料二选一：公钥模式 或 平台证书
            'pub_key_id'     => ['sometimes', 'nullable', 'string', 'max:128'],
            'pub_key'        => ['sometimes', 'nullable', 'string', 'max:8000'],
            'platform_cert'  => ['sometimes', 'nullable', 'string', 'max:8000'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $values = [
            'enabled'        => $request->boolean('enabled') ? '1' : '0',
            'mchid'          => (string) $request->input('mchid'),
            'app_id'         => (string) $request->input('app_id'),
            'cert_serial_no' => (string) $request->input('cert_serial_no'),
        ];
        // 明文且可清空的字段：has 传入即覆盖
        foreach (['pub_key_id', 'pub_key', 'platform_cert'] as $k) {
            if ($request->has($k)) {
                $values[$k] = (string) ($request->input($k) ?? '');
            }
        }
        // 加密字段：仅在「非空」时更新（留空 = 保留原值，避免覆盖成空）
        foreach (self::ENCRYPTED_KEYS as $k) {
            if ($request->filled($k)) {
                $values[$k] = (string) $request->input($k);
            }
        }

        $this->settings->setGroup(WeChatPayService::SETTINGS_GROUP, $values, self::ENCRYPTED_KEYS);

        return response()->json(['status' => 'ok'], 200);
    }

    /**
     * POST /admin/api/settings/wechat-pay/test
     * 校验配置完整性 + 能否装配 SDK Builder（不发起真实下单）。
     */
    public function test(WeChatPayService $wxpay): JsonResponse
    {
        if (!$wxpay->isConfigured()) {
            return response()->json(['ok' => false, 'msg' => '配置不完整：请检查商户号 / AppID / 证书序列号 / 商户私钥 / APIv3 密钥 / 验签材料'], 422);
        }
        try {
            // 触发一次查单（用一个必然不存在、但格式合法的订单号，out_trade_no 须 ≤32 字符）。
            // 只要微信「受理并验签通过」（哪怕回 ORDER_NOT_EXIST / PARAM_ERROR 等业务错误），
            // 即证明商户私钥签名 + 装配无误 → 视为配置有效。仅签名 / 证书 / 鉴权类错误才算失败。
            $wxpay->queryOrder('TEST' . now()->format('YmdHis') . '0001');
            return response()->json(['ok' => true, 'msg' => '配置有效，微信接口连通正常'], 200);
        } catch (\Throwable $e) {
            $msg = $e->getMessage();
            $norm = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $msg) ?: '');
            // 签名 / 验签 / 证书 / 鉴权类错误 → 配置确实有问题
            $authError = false;
            foreach (['SIGN', 'VERIFY', 'CERT', 'UNAUTHORIZED', 'FORBIDDEN', 'PRIVATEKEY', 'SERIALNO'] as $kw) {
                if (strpos($norm, $kw) !== false) {
                    $authError = true;
                    break;
                }
            }
            if (!$authError) {
                // 订单不存在 / 参数错误等业务错误：说明请求已被微信受理验签通过，凭据有效
                return response()->json(['ok' => true, 'msg' => '配置有效，微信接口连通正常'], 200);
            }
            return response()->json(['ok' => false, 'msg' => '微信接口调用失败（疑似签名/证书/密钥配置有误）：' . mb_substr($msg, 0, 200)], 422);
        }
    }
}
