<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\SelfServeOrder;
use App\Services\Mall\MallAuthorizationService;
use App\Services\Pay\WeChatPayService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * 自助付费订单管理（授权管理端后台）。
 *
 * 只读列表 / 详情 + 两个运维动作：
 *  - sync ：主动向微信查单，容灾补偿（回调丢失时手动同步并补开通授权）。
 *  - close：关闭未支付订单（微信关单 + 本地置 closed）。
 * 无退款入口（退款在微信商户平台手工处理）。
 */
class SelfServeOrderController extends Controller
{
    private MallAuthorizationService $mallAuth;

    public function __construct(MallAuthorizationService $mallAuth)
    {
        $this->mallAuth = $mallAuth;
    }

    /** GET /admin/api/self-serve-orders */
    public function index(Request $request): JsonResponse
    {
        $page = max(1, (int) $request->query('page', 1));
        $pageSize = min(100, max(1, (int) $request->query('page_size', 20)));
        $status = $request->query('status');
        $search = trim((string) $request->query('search', ''));

        $q = SelfServeOrder::query();
        if ($status && in_array($status, ['pending', 'paid', 'closed', 'failed'], true)) {
            $q->where('status', $status);
        }
        if ($search !== '') {
            $like = '%' . $search . '%';
            $q->where(function ($w) use ($like) {
                $w->where('domain', 'LIKE', $like)
                  ->orWhere('order_no', 'LIKE', $like);
            });
        }

        $total = $q->count();
        $rows = $q->orderByDesc('id')
            ->skip(($page - 1) * $pageSize)
            ->take($pageSize)
            ->get();

        return response()->json([
            'total' => $total,
            'page' => $page,
            'page_size' => $pageSize,
            'items' => $rows->map(fn (SelfServeOrder $o) => $this->formatOrder($o)),
        ], 200);
    }

    /** GET /admin/api/self-serve-orders/{id} */
    public function show(int $id): JsonResponse
    {
        $order = SelfServeOrder::find($id);
        if (!$order) {
            return response()->json(['error' => 'order_not_found'], 404);
        }
        $data = $this->formatOrder($order);
        $data['notify_payload'] = $order->notify_payload;
        return response()->json($data, 200);
    }

    /**
     * POST /admin/api/self-serve-orders/{id}/sync
     * 主动向微信查单：SUCCESS 且本地仍 pending → 补结算（开通授权 + 置 paid）。
     */
    public function sync(int $id, WeChatPayService $wxpay): JsonResponse
    {
        $order = SelfServeOrder::find($id);
        if (!$order) {
            return response()->json(['error' => 'order_not_found'], 404);
        }
        if (!$wxpay->isConfigured()) {
            return response()->json(['error' => 'wechat_pay_unconfigured'], 503);
        }

        try {
            $tx = $wxpay->queryOrder($order->order_no);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'wx_query_failed', 'message' => mb_substr($e->getMessage(), 0, 200)], 502);
        }

        $tradeState = (string) ($tx['trade_state'] ?? '');

        try {
            DB::transaction(function () use ($order, $tx, $tradeState) {
                /** @var SelfServeOrder $locked */
                $locked = SelfServeOrder::where('id', $order->id)->lockForUpdate()->first();
                if ($locked->status !== SelfServeOrder::STATUS_PENDING) {
                    return; // 已是终态，幂等
                }

                if ($tradeState === 'SUCCESS') {
                    $wxTotal = (int) ($tx['amount']['total'] ?? -1);
                    $orderCents = (int) bcmul((string) $locked->amount, '100', 0);
                    if ($wxTotal !== $orderCents) {
                        throw new \RuntimeException("amount mismatch wx={$wxTotal} order={$orderCents}");
                    }
                    foreach ((array) $locked->mall_keys as $mallKey) {
                        $this->mallAuth->setAuthorization((string) $locked->client_id, (string) $mallKey, true);
                    }
                    $locked->status = SelfServeOrder::STATUS_PAID;
                    $locked->paid_at = now();
                    $locked->wx_transaction_id = (string) ($tx['transaction_id'] ?? '');
                    $locked->save();
                    Log::info('[self-serve] order settled via admin sync', ['order_no' => $locked->order_no]);
                } elseif (in_array($tradeState, ['CLOSED', 'REVOKED', 'PAYERROR'], true)) {
                    $locked->status = SelfServeOrder::STATUS_CLOSED;
                    $locked->closed_at = now();
                    $locked->save();
                }
                // NOTPAY / USERPAYING：保持 pending
            });
        } catch (\Throwable $e) {
            return response()->json(['error' => 'sync_failed', 'message' => mb_substr($e->getMessage(), 0, 200)], 500);
        }

        return response()->json([
            'wx_trade_state' => $tradeState,
            'order' => $this->formatOrder($order->fresh()),
        ], 200);
    }

    /**
     * POST /admin/api/self-serve-orders/{id}/close
     * 关闭未支付订单：微信关单（失败忽略）+ 本地置 closed。
     */
    public function close(int $id, WeChatPayService $wxpay): JsonResponse
    {
        $order = SelfServeOrder::find($id);
        if (!$order) {
            return response()->json(['error' => 'order_not_found'], 404);
        }
        if ($order->status !== SelfServeOrder::STATUS_PENDING) {
            return response()->json(['error' => 'not_closable', 'status' => $order->status], 409);
        }

        if ($wxpay->isConfigured()) {
            try {
                $wxpay->closeOrder($order->order_no);
            } catch (\Throwable $e) {
                // 微信关单失败（如订单已支付/已关闭）忽略，以本地状态为准
                Log::warning('[self-serve] wx closeOrder failed: ' . $e->getMessage());
            }
        }

        $order->status = SelfServeOrder::STATUS_CLOSED;
        $order->closed_at = now();
        $order->save();

        return response()->json(['status' => 'closed', 'order' => $this->formatOrder($order)], 200);
    }

    /** 统一的后台订单结构。 */
    private function formatOrder(SelfServeOrder $order): array
    {
        $mallKeys = (array) $order->mall_keys;
        return [
            'id'                => $order->id,
            'order_no'          => $order->order_no,
            'domain'            => $order->domain,
            'client_id'         => $order->client_id,
            'mall_keys'         => $mallKeys,
            'mall_labels'       => array_map(fn ($k) => MallAuthorizationService::MALL_LABELS[$k] ?? $k, $mallKeys),
            'amount'            => (string) $order->amount,
            'currency'          => $order->currency,
            'channel'           => $order->channel,
            'status'            => $order->derivedStatus(),
            'wx_transaction_id' => $order->wx_transaction_id,
            'client_ip'         => $order->client_ip,
            'expires_at'        => optional($order->expires_at)->toIso8601String(),
            'paid_at'           => optional($order->paid_at)->toIso8601String(),
            'closed_at'         => optional($order->closed_at)->toIso8601String(),
            'created_at'        => optional($order->created_at)->toIso8601String(),
        ];
    }
}
