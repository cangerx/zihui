<?php

namespace App\Http\Controllers\SelfServe;

use App\Http\Controllers\Controller;
use App\Models\PackagingLicenseOrder;
use App\Services\Mall\MallAuthorizationService;
use App\Services\Packaging\PackagingLicenseGrant;
use App\Services\Packaging\PackagingLicenseQuote;
use App\Services\Packaging\PackagingLicenseSettings;
use App\Services\Pay\WeChatPayService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;

class PackagingPurchaseController extends Controller
{
    private const ORDER_TTL_MINUTES = 15;

    public function __construct(
        private MallAuthorizationService $mallAuth,
        private WeChatPayService $wxpay,
        private PackagingLicenseSettings $licenseSettings,
        private PackagingLicenseGrant $grant,
    ) {
    }

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

        $settings = $this->licenseSettings->snapshot();
        $flags = $this->grant->flags($client);

        return response()->json([
            'found' => true,
            'domain' => $client->domain,
            'status' => $client->status,
            'purchasable' => $this->isClientPurchasable($client) && $settings['self_serve_enabled'],
            'self_serve_enabled' => $settings['self_serve_enabled'],
            'can_use_github_packaging' => $flags['can_use_github_packaging'],
            'can_use_mac_packaging' => $flags['can_use_mac_packaging'],
            'prices' => [
                'win' => $settings['win_price'],
                'mac' => $settings['mac_price'],
            ],
        ]);
    }

    public function createOrder(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'domain' => ['required', 'string', 'max:255'],
            'features' => ['required', 'array', 'min:1', 'max:2'],
            'features.*' => ['required', 'string', 'in:win,mac'],
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

        $settings = $this->licenseSettings->snapshot();
        $quote = PackagingLicenseQuote::quote(
            $this->grant->flags($client),
            (array) $request->input('features'),
            $settings['win_price'],
            $settings['mac_price'],
            $settings['self_serve_enabled']
        );
        if (!$quote['ok']) {
            $status = $quote['error'] === 'self_serve_disabled' ? 403 : 422;
            return response()->json(['error' => $quote['error']], $status);
        }

        $toGrant = $quote['features'];
        $reusable = PackagingLicenseOrder::where('client_id', $client->client_id)
            ->where('status', PackagingLicenseOrder::STATUS_PENDING)
            ->where('expires_at', '>', now())
            ->orderByDesc('id')
            ->get()
            ->first(function (PackagingLicenseOrder $o) use ($toGrant) {
                $keys = (array) $o->features;
                sort($keys);
                $want = $toGrant;
                sort($want);
                return $keys === $want;
            });
        if ($reusable) {
            return response()->json($this->formatOrder($reusable, true));
        }

        $now = now();
        $order = new PackagingLicenseOrder([
            'order_no' => PackagingLicenseOrder::generateOrderNo(),
            'client_id' => $client->client_id,
            'domain' => $client->domain,
            'features' => $toGrant,
            'amount' => number_format((float) $quote['amount'], 2, '.', ''),
            'currency' => 'CNY',
            'status' => PackagingLicenseOrder::STATUS_PENDING,
            'channel' => 'wechat_native',
            'expires_at' => $now->copy()->addMinutes(self::ORDER_TTL_MINUTES),
            'client_ip' => substr((string) $request->ip(), 0, 45),
            'remark' => '[packaging] ' . implode(',', $toGrant),
        ]);
        $order->save();

        try {
            $labels = array_map(fn ($k) => $k === 'mac' ? 'Mac 打包授权' : '云控端打包授权', $toGrant);
            $codeUrl = $this->wxpay->nativePrepayRaw(
                $order->order_no,
                (string) $order->amount,
                (string) $order->currency,
                $order->expires_at,
                $this->buildNotifyUrl($request),
                '打包授权开通：' . implode('、', $labels)
            );
            $order->code_url = $codeUrl;
            $order->save();
        } catch (\Throwable $e) {
            Log::error('[packaging-self-serve] wxpay nativePrepay failed: ' . $e->getMessage());
            $order->status = PackagingLicenseOrder::STATUS_FAILED;
            $order->remark = '[packaging] wxpay error: ' . mb_substr($e->getMessage(), 0, 200);
            $order->save();
            return response()->json(['error' => 'wxpay_prepay_failed', 'message' => '微信下单失败：' . $e->getMessage()], 502);
        }

        return response()->json($this->formatOrder($order, false));
    }

    public function showOrder(string $orderNo): JsonResponse
    {
        $order = PackagingLicenseOrder::where('order_no', $orderNo)->first();
        if (!$order) {
            return response()->json(['error' => 'order_not_found'], 404);
        }
        if ($order->isExpired()) {
            $order->status = PackagingLicenseOrder::STATUS_CLOSED;
            $order->closed_at = now();
            $order->save();
        }

        $payload = $this->formatOrder($order, false);
        if ($order->status === PackagingLicenseOrder::STATUS_PAID) {
            $client = DB::table('authorized_clients')->where('client_id', $order->client_id)->first();
            if ($client) {
                $payload['can_use_github_packaging'] = (bool) ($client->can_use_github_packaging ?? false);
                $payload['can_use_mac_packaging'] = (bool) ($client->can_use_mac_packaging ?? false);
            }
        }
        return response()->json($payload);
    }

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
                Log::debug('[packaging-self-serve] notify signature probe ignored: ' . $e->getMessage());
            } else {
                Log::warning('[packaging-self-serve] notify verify failed: ' . $e->getMessage());
            }
            return response()->json(['code' => 'FAIL', 'message' => $e->getMessage()], 401);
        }

        $orderNo = (string) ($tx['out_trade_no'] ?? '');
        if ($orderNo === '') {
            return response()->json(['code' => 'FAIL', 'message' => 'missing out_trade_no'], 400);
        }

        try {
            DB::transaction(function () use ($tx, $orderNo) {
                $this->settlePaid($orderNo, $tx);
            });
        } catch (\Throwable $e) {
            Log::error('[packaging-self-serve] notify processing failed: ' . $e->getMessage());
            return response()->json(['code' => 'FAIL', 'message' => 'processing error'], 500);
        }

        return response()->json(['code' => 'SUCCESS']);
    }

    /**
     * @param array<string, mixed> $tx
     */
    public function settlePaid(string $orderNo, array $tx): void
    {
        /** @var PackagingLicenseOrder|null $order */
        $order = PackagingLicenseOrder::where('order_no', $orderNo)->lockForUpdate()->first();
        if (!$order) {
            Log::warning("[packaging-self-serve] notify order missing: {$orderNo}");
            return;
        }

        $order->notify_payload = json_encode([
            'received_at' => now()->toIso8601String(),
            'tx' => $tx,
        ], JSON_UNESCAPED_UNICODE);

        if ($order->status !== PackagingLicenseOrder::STATUS_PENDING) {
            $order->save();
            return;
        }

        $tradeState = (string) ($tx['trade_state'] ?? '');
        if ($tradeState !== 'SUCCESS') {
            $order->save();
            return;
        }

        $wxTotal = (int) ($tx['amount']['total'] ?? -1);
        $orderCents = (int) bcmul((string) $order->amount, '100', 0);
        if ($wxTotal !== $orderCents) {
            throw new \RuntimeException('amount mismatch');
        }

        $this->grant->grant((string) $order->client_id, (array) $order->features);
        PackagingLicenseOrder::assertTransition($order->status, PackagingLicenseOrder::STATUS_PAID);
        $order->status = PackagingLicenseOrder::STATUS_PAID;
        $order->paid_at = now();
        $order->wx_transaction_id = (string) ($tx['transaction_id'] ?? '');
        $order->save();
    }

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

    private function formatOrder(PackagingLicenseOrder $order, bool $reused): array
    {
        return [
            'order_no' => $order->order_no,
            'domain' => $order->domain,
            'features' => (array) $order->features,
            'amount' => (string) $order->amount,
            'currency' => $order->currency,
            'code_url' => $order->code_url,
            'status' => $order->derivedStatus(),
            'paid' => $order->status === PackagingLicenseOrder::STATUS_PAID,
            'expires_at' => optional($order->expires_at)->toIso8601String(),
            'paid_at' => optional($order->paid_at)->toIso8601String(),
            'reused' => $reused,
        ];
    }

    private function buildNotifyUrl(Request $request): string
    {
        $base = (string) config('app.url', '');
        if ($base === '' || $base === 'http://localhost') {
            $base = $request->getSchemeAndHttpHost();
        }
        $base = preg_replace('#^http://#i', 'https://', $base) ?? $base;
        return rtrim($base, '/') . '/api/self-serve/packaging/notify';
    }
}
