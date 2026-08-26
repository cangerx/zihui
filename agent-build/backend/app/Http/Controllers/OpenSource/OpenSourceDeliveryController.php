<?php

namespace App\Http\Controllers\OpenSource;

use App\Http\Controllers\Controller;
use App\Models\OpenSourceOrder;
use App\Services\Pay\WeChatPayService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;

/**
 * 开源交付 —— 公开接口（免登录）。
 *
 * 流程：用户在独立公开页选择「先锋开源」档 → 填写购买人信息（姓名/电话/微信号/邮箱）→
 * 微信 Native 扫码 → notify 回调验签后标记订单已支付。交付（拉群 / 发代码包 / 发规则文档）
 * 由运营在后台看到订单后人工完成，本组接口不做任何自动开通。
 *
 * 免费档（8 月底面向所有人公开、仅桌面端一次性）无需付费、不下单，页面仅作展示，不经过本接口。
 *
 * 安全说明：接口公开、按 throttle 限流；notify 由微信签名 + APIv3 解密保证真实性。
 */
class OpenSourceDeliveryController extends Controller
{
    /** 订单有效期（分钟），微信侧 time_expire 同步使用。 */
    private const ORDER_TTL_MINUTES = 15;

    /** 先锋开源档价格（元）。 */
    private const PRICE_PIONEER = 500;

    private WeChatPayService $wxpay;

    public function __construct(WeChatPayService $wxpay)
    {
        $this->wxpay = $wxpay;
    }

    /**
     * GET /api/open-source/config
     * 返回各档价格与支付是否可用，供公开页展示（价格单一真源在后端）。
     */
    public function config(): JsonResponse
    {
        return response()->json([
            'pay_enabled' => $this->wxpay->isConfigured(),
            'tiers' => [
                'pioneer' => ['price' => self::PRICE_PIONEER, 'currency' => 'CNY'],
            ],
        ], 200);
    }

    /**
     * POST /api/open-source/order
     * Body: { tier: 'pioneer', buyer_name, buyer_phone, buyer_wechat, buyer_email }
     * 校验购买人信息 → 按档定价 → 微信 Native 下单返回二维码。
     */
    public function createOrder(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'tier'         => ['nullable', 'string', 'in:' . OpenSourceOrder::TIER_PIONEER],
            'buyer_name'   => ['required', 'string', 'max:60'],
            'buyer_phone'  => ['required', 'string', 'regex:/^[0-9+\-\s]{5,40}$/'],
            'buyer_wechat' => ['required', 'string', 'max:80'],
            'buyer_email'  => ['required', 'email:rfc', 'max:120'],
            // 先锋开源面向已授权用户，购买时登记原授权域名（供运营核对授权）
            'buyer_domain' => ['required', 'string', 'max:255', 'regex:/^[A-Za-z0-9.\-:\/]+$/'],
        ], [
            'buyer_name.required'   => '请填写姓名',
            'buyer_phone.required'  => '请填写电话',
            'buyer_phone.regex'     => '电话格式不正确',
            'buyer_wechat.required' => '请填写微信号',
            'buyer_email.required'  => '请填写邮箱',
            'buyer_email.email'     => '邮箱格式不正确',
            'buyer_domain.required' => '请填写已授权域名',
            'buyer_domain.regex'    => '域名格式不正确',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        if (!$this->wxpay->isConfigured()) {
            return response()->json(['error' => 'wechat_pay_unconfigured', 'message' => '微信支付未配置或未启用'], 503);
        }

        $tier   = (string) ($request->input('tier') ?: OpenSourceOrder::TIER_PIONEER);
        $amount = number_format((float) self::PRICE_PIONEER, 2, '.', '');
        $email  = trim((string) $request->input('buyer_email'));
        // 归一化已授权域名：去 scheme、去路径与末尾斜杠、转小写
        $domain = strtolower(trim((string) $request->input('buyer_domain')));
        $domain = preg_replace('#^https?://#i', '', $domain) ?? $domain;
        $domain = substr(explode('/', $domain)[0], 0, 255);

        // 复用：同邮箱同档的未过期 pending 订单，直接返回原二维码，避免用户重复提交建多单。
        $reusable = OpenSourceOrder::where('buyer_email', $email)
            ->where('tier', $tier)
            ->where('status', OpenSourceOrder::STATUS_PENDING)
            ->where('expires_at', '>', now())
            ->whereNotNull('code_url')
            ->orderByDesc('id')
            ->first();
        if ($reusable) {
            return response()->json($this->formatOrder($reusable, true), 200);
        }

        $now = now();
        $order = new OpenSourceOrder([
            'order_no'     => OpenSourceOrder::generateOrderNo(),
            'tier'         => $tier,
            'buyer_name'   => trim((string) $request->input('buyer_name')),
            'buyer_phone'  => trim((string) $request->input('buyer_phone')),
            'buyer_wechat' => trim((string) $request->input('buyer_wechat')),
            'buyer_email'  => $email,
            'buyer_domain' => $domain,
            'amount'       => $amount,
            'currency'     => 'CNY',
            'status'       => OpenSourceOrder::STATUS_PENDING,
            'channel'      => 'wechat_native',
            'expires_at'   => $now->copy()->addMinutes(self::ORDER_TTL_MINUTES),
            'client_ip'    => substr((string) $request->ip(), 0, 45),
            'remark'       => '[open-source] ' . $tier,
        ]);
        $order->save();

        try {
            $codeUrl = $this->wxpay->nativePrepayRaw(
                $order->order_no,
                (string) $order->amount,
                (string) $order->currency,
                $order->expires_at,
                $this->buildNotifyUrl($request),
                '开源交付 · 先锋开源'
            );
            $order->code_url = $codeUrl;
            $order->save();
        } catch (\Throwable $e) {
            Log::error('[open-source] wxpay nativePrepay failed: ' . $e->getMessage());
            $order->status = OpenSourceOrder::STATUS_FAILED;
            $order->remark = '[open-source] wxpay error: ' . mb_substr($e->getMessage(), 0, 200);
            $order->save();
            return response()->json(['error' => 'wxpay_prepay_failed', 'message' => '微信下单失败：' . $e->getMessage()], 502);
        }

        return response()->json($this->formatOrder($order, false), 200);
    }

    /**
     * GET /api/open-source/order/{orderNo}
     * 前端轮询订单状态。pending 但已过期则惰性关单。
     */
    public function showOrder(string $orderNo): JsonResponse
    {
        $order = OpenSourceOrder::where('order_no', $orderNo)->first();
        if (!$order) {
            return response()->json(['error' => 'order_not_found'], 404);
        }

        if ($order->isExpired()) {
            $order->status = OpenSourceOrder::STATUS_CLOSED;
            $order->closed_at = now();
            $order->save();
        }

        return response()->json($this->formatOrder($order, false), 200);
    }

    /**
     * POST /api/open-source/notify
     * 微信支付回调。公开端点，靠平台验签 + APIv3 解密保证安全。成功后仅标记订单已支付。
     */
    public function notify(Request $request): JsonResponse
    {
        $isProbe = str_starts_with(
            (string) $request->header('Wechatpay-Signature', ''),
            'WECHATPAY/SIGNTEST/'
        );

        try {
            $tx = $this->wxpay->verifyAndDecryptNotify($request);
        } catch (\Throwable $e) {
            if ($isProbe) {
                Log::debug('[open-source] notify signature probe ignored: ' . $e->getMessage());
            } else {
                Log::warning('[open-source] notify verify failed: ' . $e->getMessage());
            }
            return response()->json(['code' => 'FAIL', 'message' => $e->getMessage()], 401);
        }

        $orderNo = (string) ($tx['out_trade_no'] ?? '');
        if ($orderNo === '') {
            return response()->json(['code' => 'FAIL', 'message' => 'missing out_trade_no'], 400);
        }

        try {
            DB::transaction(function () use ($tx, $orderNo) {
                /** @var OpenSourceOrder|null $order */
                $order = OpenSourceOrder::where('order_no', $orderNo)->lockForUpdate()->first();
                if (!$order) {
                    Log::warning("[open-source] notify order missing: {$orderNo}");
                    return;
                }

                $order->notify_payload = json_encode([
                    'received_at' => now()->toIso8601String(),
                    'tx' => $tx,
                ], JSON_UNESCAPED_UNICODE);

                // 幂等：非 pending 不再处理
                if ($order->status !== OpenSourceOrder::STATUS_PENDING) {
                    $order->save();
                    return;
                }

                $tradeState = (string) ($tx['trade_state'] ?? '');
                if ($tradeState !== 'SUCCESS') {
                    Log::warning("[open-source] notify non-success state: {$tradeState} order={$orderNo}");
                    $order->save();
                    return;
                }

                // 金额校验（微信 amount.total 单位为分）
                $wxTotal = (int) ($tx['amount']['total'] ?? -1);
                $orderCents = (int) bcmul((string) $order->amount, '100', 0);
                if ($wxTotal !== $orderCents) {
                    Log::error("[open-source] amount mismatch order={$orderNo} wx={$wxTotal} order={$orderCents}");
                    throw new \RuntimeException('amount mismatch');
                }

                OpenSourceOrder::assertTransition($order->status, OpenSourceOrder::STATUS_PAID);
                $order->status = OpenSourceOrder::STATUS_PAID;
                $order->paid_at = now();
                $order->wx_transaction_id = (string) ($tx['transaction_id'] ?? '');
                $order->save();

                Log::info('[open-source] order paid', [
                    'order_no' => $orderNo,
                    'tier' => $order->tier,
                    'buyer_email' => $order->buyer_email,
                ]);
            });
        } catch (\Throwable $e) {
            Log::error('[open-source] notify processing failed: ' . $e->getMessage());
            return response()->json(['code' => 'FAIL', 'message' => 'processing error'], 500);
        }

        return response()->json(['code' => 'SUCCESS']);
    }

    /** 统一的对外订单结构（不回带购买人隐私信息，仅订单状态相关字段）。 */
    private function formatOrder(OpenSourceOrder $order, bool $reused): array
    {
        return [
            'order_no'   => $order->order_no,
            'tier'       => $order->tier,
            'amount'     => (string) $order->amount,
            'currency'   => $order->currency,
            'code_url'   => $order->code_url,
            'status'     => $order->derivedStatus(),
            'paid'       => $order->status === OpenSourceOrder::STATUS_PAID,
            'expires_at' => optional($order->expires_at)->toIso8601String(),
            'paid_at'    => optional($order->paid_at)->toIso8601String(),
            'reused'     => $reused,
        ];
    }

    /**
     * 计算微信回调地址：优先 APP_URL（防 Host 伪造），强制 https（微信 V3 要求）。
     * 与 MallPurchaseController::buildNotifyUrl 同款思路。
     */
    private function buildNotifyUrl(Request $request): string
    {
        $base = (string) config('app.url', '');
        if ($base === '' || $base === 'http://localhost') {
            $base = $request->getSchemeAndHttpHost();
        }
        $base = preg_replace('#^http://#i', 'https://', $base) ?? $base;
        return rtrim($base, '/') . '/api/open-source/notify';
    }
}
