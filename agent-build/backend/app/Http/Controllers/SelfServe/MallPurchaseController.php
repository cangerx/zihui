<?php

namespace App\Http\Controllers\SelfServe;

use App\Http\Controllers\Controller;
use App\Models\SelfServeOrder;
use App\Services\Mall\MallAuthorizationService;
use App\Services\Pay\WeChatPayService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;

/**
 * 自助付费开通商城授权 —— 公开接口（免登录）。
 *
 * 流程：用户在独立公开页输入域名 → query 查三商城授权态 → 勾选未授权项下单 →
 * 微信 Native 扫码 → notify 回调验签后自动写 client_mall_authorizations 授权位。
 *
 * 安全说明：本组接口公开、无 domain_binding（访问者 Origin 是授权管理端自身域名，
 * 不是被查询域名），按 throttle 限流。身份绑定靠「输入的域名 → authorized_clients 行」，
 * 无归属校验（产品取向：纯自助、谁付费谁开通）。notify 由微信签名保证真实性。
 */
class MallPurchaseController extends Controller
{
    /** 订单有效期（分钟），微信侧 time_expire 同步使用。 */
    private const ORDER_TTL_MINUTES = 15;

    private MallAuthorizationService $mallAuth;
    private WeChatPayService $wxpay;

    public function __construct(MallAuthorizationService $mallAuth, WeChatPayService $wxpay)
    {
        $this->mallAuth = $mallAuth;
        $this->wxpay = $wxpay;
    }

    /**
     * GET /api/self-serve/mall-auth/query?domain=xxx
     * 查询某域名是否在授权列表，存在则返回三商城当前授权态。
     */
    public function query(Request $request): JsonResponse
    {
        $domain = trim((string) $request->query('domain', ''));
        if ($domain === '') {
            return response()->json(['error' => 'domain_required'], 422);
        }

        $client = $this->mallAuth->findClientByDomain($domain);
        if (!$client) {
            return response()->json(['found' => false], 200);
        }

        $malls = $this->mallAuth->getAuthorizations($client);
        $purchasable = $this->isClientPurchasable($client);

        return response()->json([
            'found' => true,
            'domain' => $client->domain,
            'status' => $client->status,
            'purchasable' => $purchasable,
            'malls' => $malls,
            'labels' => MallAuthorizationService::MALL_LABELS,
            'prices' => [
                'single' => MallAuthorizationService::PRICE_SINGLE,
                'bundle' => MallAuthorizationService::PRICE_BUNDLE,
            ],
        ], 200);
    }

    /**
     * POST /api/self-serve/mall-auth/order
     * Body: { domain: string, mall_keys: string[] }
     * 按勾选的「待开通」商城数计价（1 个=50，2~3 个=100），微信 Native 下单返回二维码。
     */
    public function createOrder(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'domain'      => ['required', 'string', 'max:255'],
            'mall_keys'   => ['required', 'array', 'min:1', 'max:3'],
            'mall_keys.*' => ['required', 'string', 'in:' . implode(',', MallAuthorizationService::MALL_KEYS)],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        if (!$this->wxpay->isConfigured()) {
            return response()->json(['error' => 'wechat_pay_unconfigured', 'message' => '微信支付未配置或未启用'], 503);
        }

        $client = $this->mallAuth->findClientByDomain((string) $request->input('domain'));
        if (!$client) {
            return response()->json(['error' => 'domain_not_found', 'message' => '该域名不在授权列表中'], 404);
        }
        if (!$this->isClientPurchasable($client)) {
            return response()->json(['error' => 'client_inactive', 'status' => $client->status], 403);
        }

        // 服务端重算当前授权态，只对「尚未授权」的勾选项收费、开通（防止前端篡改已授权项重复收费）。
        $current = $this->mallAuth->getAuthorizations($client);
        $requested = array_values(array_unique($request->input('mall_keys')));
        $toGrant = array_values(array_filter($requested, fn ($k) => empty($current[$k])));

        if (empty($toGrant)) {
            return response()->json(['error' => 'already_authorized', 'message' => '所选商城均已授权，无需重复开通'], 422);
        }

        sort($toGrant);
        $amount = $this->mallAuth->priceFor(count($toGrant));

        // 复用：同域名同商城组合的未过期 pending 订单，直接返回原二维码，避免重复建单。
        $reusable = SelfServeOrder::where('client_id', $client->client_id)
            ->where('status', SelfServeOrder::STATUS_PENDING)
            ->where('expires_at', '>', now())
            ->orderByDesc('id')
            ->get()
            ->first(function (SelfServeOrder $o) use ($toGrant) {
                $keys = (array) $o->mall_keys;
                sort($keys);
                return $keys === $toGrant;
            });
        if ($reusable) {
            return response()->json($this->formatOrder($reusable, true), 200);
        }

        $now = now();
        $order = new SelfServeOrder([
            'order_no'   => SelfServeOrder::generateOrderNo(),
            'client_id'  => $client->client_id,
            'domain'     => $client->domain,
            'mall_keys'  => $toGrant,
            'amount'     => number_format((float) $amount, 2, '.', ''),
            'currency'   => 'CNY',
            'status'     => SelfServeOrder::STATUS_PENDING,
            'channel'    => 'wechat_native',
            'expires_at' => $now->copy()->addMinutes(self::ORDER_TTL_MINUTES),
            'client_ip'  => substr((string) $request->ip(), 0, 45),
            'remark'     => '[self-serve] ' . implode(',', $toGrant),
        ]);
        $order->save();

        try {
            $labels = array_map(fn ($k) => MallAuthorizationService::MALL_LABELS[$k] ?? $k, $toGrant);
            $description = '商城授权开通：' . implode('、', $labels);
            $codeUrl = $this->wxpay->nativePrepay($order, $this->buildNotifyUrl($request), $description);
            $order->code_url = $codeUrl;
            $order->save();
        } catch (\Throwable $e) {
            Log::error('[self-serve] wxpay nativePrepay failed: ' . $e->getMessage());
            $order->status = SelfServeOrder::STATUS_FAILED;
            $order->remark = '[self-serve] wxpay error: ' . mb_substr($e->getMessage(), 0, 200);
            $order->save();
            return response()->json(['error' => 'wxpay_prepay_failed', 'message' => '微信下单失败：' . $e->getMessage()], 502);
        }

        return response()->json($this->formatOrder($order, false), 200);
    }

    /**
     * GET /api/self-serve/mall-auth/order/{orderNo}
     * 前端轮询订单状态。pending 但已过期则惰性关单。已支付时附带最新授权 map。
     */
    public function showOrder(string $orderNo): JsonResponse
    {
        $order = SelfServeOrder::where('order_no', $orderNo)->first();
        if (!$order) {
            return response()->json(['error' => 'order_not_found'], 404);
        }

        // 惰性关单：pending 且已过期 → 置 closed（避免长期挂着无效 pending）。
        if ($order->isExpired()) {
            $order->status = SelfServeOrder::STATUS_CLOSED;
            $order->closed_at = now();
            $order->save();
        }

        $payload = $this->formatOrder($order, false);
        // 已支付：回带该域名当前授权态，前端据此刷新页面勾选。
        if ($order->status === SelfServeOrder::STATUS_PAID) {
            $client = DB::table('authorized_clients')->where('client_id', $order->client_id)->first();
            if ($client) {
                $payload['malls'] = $this->mallAuth->getAuthorizations($client);
            }
        }
        return response()->json($payload, 200);
    }

    /**
     * POST /api/self-serve/mall-auth/notify
     * 微信支付回调。公开端点，靠平台验签 + APIv3 解密保证安全。
     * 成功后按订单 mall_keys 自动写授权位。
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
                Log::debug('[self-serve] notify signature probe ignored: ' . $e->getMessage());
            } else {
                Log::warning('[self-serve] notify verify failed: ' . $e->getMessage());
            }
            return response()->json(['code' => 'FAIL', 'message' => $e->getMessage()], 401);
        }

        $orderNo = (string) ($tx['out_trade_no'] ?? '');
        if ($orderNo === '') {
            return response()->json(['code' => 'FAIL', 'message' => 'missing out_trade_no'], 400);
        }

        try {
            DB::transaction(function () use ($tx, $orderNo) {
                /** @var SelfServeOrder|null $order */
                $order = SelfServeOrder::where('order_no', $orderNo)->lockForUpdate()->first();
                if (!$order) {
                    Log::warning("[self-serve] notify order missing: {$orderNo}");
                    return;
                }

                $order->notify_payload = json_encode([
                    'received_at' => now()->toIso8601String(),
                    'tx' => $tx,
                ], JSON_UNESCAPED_UNICODE);

                // 幂等：非 pending 不再处理
                if ($order->status !== SelfServeOrder::STATUS_PENDING) {
                    $order->save();
                    return;
                }

                $tradeState = (string) ($tx['trade_state'] ?? '');
                if ($tradeState !== 'SUCCESS') {
                    Log::warning("[self-serve] notify non-success state: {$tradeState} order={$orderNo}");
                    $order->save();
                    return;
                }

                // 金额校验（微信 amount.total 单位为分）
                $wxTotal = (int) ($tx['amount']['total'] ?? -1);
                $orderCents = (int) bcmul((string) $order->amount, '100', 0);
                if ($wxTotal !== $orderCents) {
                    Log::error("[self-serve] amount mismatch order={$orderNo} wx={$wxTotal} order={$orderCents}");
                    throw new \RuntimeException('amount mismatch');
                }

                // 自动开通：逐个商城写授权位（ewei 由 service 内部同步回写旧列）
                foreach ((array) $order->mall_keys as $mallKey) {
                    $this->mallAuth->setAuthorization((string) $order->client_id, (string) $mallKey, true);
                }

                SelfServeOrder::assertTransition($order->status, SelfServeOrder::STATUS_PAID);
                $order->status = SelfServeOrder::STATUS_PAID;
                $order->paid_at = now();
                $order->wx_transaction_id = (string) ($tx['transaction_id'] ?? '');
                $order->save();

                Log::info('[self-serve] order paid & malls authorized', [
                    'order_no' => $orderNo,
                    'client_id' => $order->client_id,
                    'mall_keys' => $order->mall_keys,
                ]);
            });
        } catch (\Throwable $e) {
            Log::error('[self-serve] notify processing failed: ' . $e->getMessage());
            return response()->json(['code' => 'FAIL', 'message' => 'processing error'], 500);
        }

        return response()->json(['code' => 'SUCCESS']);
    }

    /**
     * 该域名是否可自助开通：与 VerifyDomainBinding 同口径 —— status=active 且未过期。
     * 避免「status=active 但 expires_at 已过期」的客户端付了款、授权也写了，
     * 却仍被 auth-check 以 client_expired 拒绝（钱付了功能不生效）。
     */
    private function isClientPurchasable(object $client): bool
    {
        if (($client->status ?? '') !== 'active') {
            return false;
        }
        if (!empty($client->expires_at) && strtotime((string) $client->expires_at) < time()) {
            return false;
        }
        return true;
    }

    /** 统一的对外订单结构（不含 notify_payload 等内部字段）。 */
    private function formatOrder(SelfServeOrder $order, bool $reused): array
    {
        return [
            'order_no'   => $order->order_no,
            'domain'     => $order->domain,
            'mall_keys'  => (array) $order->mall_keys,
            'amount'     => (string) $order->amount,
            'currency'   => $order->currency,
            'code_url'   => $order->code_url,
            'status'     => $order->derivedStatus(),
            'paid'       => $order->status === SelfServeOrder::STATUS_PAID,
            'expires_at' => optional($order->expires_at)->toIso8601String(),
            'paid_at'    => optional($order->paid_at)->toIso8601String(),
            'reused'     => $reused,
        ];
    }

    /**
     * 计算微信回调地址：优先 APP_URL（防 Host 伪造），强制 https（微信 V3 要求）。
     * 与 agent-admin PaymentController::buildNotifyUrl 同款思路。
     */
    private function buildNotifyUrl(Request $request): string
    {
        $base = (string) config('app.url', '');
        if ($base === '' || $base === 'http://localhost') {
            $base = $request->getSchemeAndHttpHost();
        }
        $base = preg_replace('#^http://#i', 'https://', $base) ?? $base;
        return rtrim($base, '/') . '/api/self-serve/mall-auth/notify';
    }
}
