<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\OpenSourceOrder;
use App\Services\Pay\WeChatPayService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * 开源交付订单管理（授权管理端后台）。
 *
 * 列表 / 详情（含购买人姓名/电话/微信/邮箱，供人工交付）+ 运维动作：
 *  - sync    ：主动向微信查单，容灾补偿（回调丢失时手动同步置 paid）。
 *  - close   ：关闭未支付订单（微信关单 + 本地置 closed）。
 *  - deliver ：标记已交付（运营拉群 / 发代码包 / 发文档后勾选，纯记录）。
 * 无退款入口（退款在微信商户平台手工处理）。
 */
class OpenSourceOrderController extends Controller
{
    /** GET /admin/api/open-source-orders */
    public function index(Request $request): JsonResponse
    {
        $page = max(1, (int) $request->query('page', 1));
        $pageSize = min(100, max(1, (int) $request->query('page_size', 20)));
        $status = $request->query('status');
        $search = trim((string) $request->query('search', ''));

        $q = OpenSourceOrder::query();
        if ($status && in_array($status, ['pending', 'paid', 'closed', 'failed'], true)) {
            $q->where('status', $status);
        }
        if ($search !== '') {
            $like = '%' . $search . '%';
            $q->where(function ($w) use ($like) {
                $w->where('order_no', 'LIKE', $like)
                  ->orWhere('buyer_name', 'LIKE', $like)
                  ->orWhere('buyer_phone', 'LIKE', $like)
                  ->orWhere('buyer_wechat', 'LIKE', $like)
                  ->orWhere('buyer_email', 'LIKE', $like);
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
            'items' => $rows->map(fn (OpenSourceOrder $o) => $this->formatOrder($o)),
        ], 200);
    }

    /** GET /admin/api/open-source-orders/{id} */
    public function show(int $id): JsonResponse
    {
        $order = OpenSourceOrder::find($id);
        if (!$order) {
            return response()->json(['error' => 'order_not_found'], 404);
        }
        $data = $this->formatOrder($order);
        $data['notify_payload'] = $order->notify_payload;
        return response()->json($data, 200);
    }

    /**
     * POST /admin/api/open-source-orders/{id}/sync
     * 主动向微信查单：SUCCESS 且本地仍 pending → 置 paid（容灾补偿，回调丢失时用）。
     */
    public function sync(int $id, WeChatPayService $wxpay): JsonResponse
    {
        $order = OpenSourceOrder::find($id);
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
                /** @var OpenSourceOrder $locked */
                $locked = OpenSourceOrder::where('id', $order->id)->lockForUpdate()->first();
                if ($locked->status !== OpenSourceOrder::STATUS_PENDING) {
                    return; // 已是终态，幂等
                }

                if ($tradeState === 'SUCCESS') {
                    $wxTotal = (int) ($tx['amount']['total'] ?? -1);
                    $orderCents = (int) bcmul((string) $locked->amount, '100', 0);
                    if ($wxTotal !== $orderCents) {
                        throw new \RuntimeException("amount mismatch wx={$wxTotal} order={$orderCents}");
                    }
                    $locked->status = OpenSourceOrder::STATUS_PAID;
                    $locked->paid_at = now();
                    $locked->wx_transaction_id = (string) ($tx['transaction_id'] ?? '');
                    $locked->save();
                    Log::info('[open-source] order settled via admin sync', ['order_no' => $locked->order_no]);
                } elseif (in_array($tradeState, ['CLOSED', 'REVOKED', 'PAYERROR'], true)) {
                    $locked->status = OpenSourceOrder::STATUS_CLOSED;
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
     * POST /admin/api/open-source-orders/{id}/close
     * 关闭未支付订单：微信关单（失败忽略）+ 本地置 closed。
     */
    public function close(int $id, WeChatPayService $wxpay): JsonResponse
    {
        $order = OpenSourceOrder::find($id);
        if (!$order) {
            return response()->json(['error' => 'order_not_found'], 404);
        }
        if ($order->status !== OpenSourceOrder::STATUS_PENDING) {
            return response()->json(['error' => 'not_closable', 'status' => $order->status], 409);
        }

        if ($wxpay->isConfigured()) {
            try {
                $wxpay->closeOrder($order->order_no);
            } catch (\Throwable $e) {
                Log::warning('[open-source] wx closeOrder failed: ' . $e->getMessage());
            }
        }

        $order->status = OpenSourceOrder::STATUS_CLOSED;
        $order->closed_at = now();
        $order->save();

        return response()->json(['status' => 'closed', 'order' => $this->formatOrder($order)], 200);
    }

    /**
     * POST /admin/api/open-source-orders/{id}/deliver
     * Body: { delivered: bool }
     * 标记 / 取消标记「已交付」（运营完成拉群 + 发代码包 + 发文档后勾选，纯记录）。
     */
    public function deliver(int $id, Request $request): JsonResponse
    {
        $order = OpenSourceOrder::find($id);
        if (!$order) {
            return response()->json(['error' => 'order_not_found'], 404);
        }
        $delivered = (bool) $request->boolean('delivered', true);
        $order->delivered = $delivered;
        $order->delivered_at = $delivered ? now() : null;
        $order->save();

        return response()->json(['order' => $this->formatOrder($order)], 200);
    }

    /** 统一的后台订单结构（含购买人信息，供人工交付）。 */
    private function formatOrder(OpenSourceOrder $order): array
    {
        return [
            'id'                => $order->id,
            'order_no'          => $order->order_no,
            'tier'              => $order->tier,
            'buyer_name'        => $order->buyer_name,
            'buyer_phone'       => $order->buyer_phone,
            'buyer_wechat'      => $order->buyer_wechat,
            'buyer_email'       => $order->buyer_email,
            'buyer_domain'      => $order->buyer_domain,
            'amount'            => (string) $order->amount,
            'currency'          => $order->currency,
            'channel'           => $order->channel,
            'status'            => $order->derivedStatus(),
            'delivered'         => (bool) $order->delivered,
            'wx_transaction_id' => $order->wx_transaction_id,
            'client_ip'         => $order->client_ip,
            'expires_at'        => optional($order->expires_at)->toIso8601String(),
            'paid_at'           => optional($order->paid_at)->toIso8601String(),
            'delivered_at'      => optional($order->delivered_at)->toIso8601String(),
            'closed_at'         => optional($order->closed_at)->toIso8601String(),
            'created_at'        => optional($order->created_at)->toIso8601String(),
        ];
    }
}
