<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Controllers\SelfServe\PackagingPurchaseController;
use App\Models\PackagingLicenseOrder;
use App\Services\Pay\WeChatPayService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class PackagingLicenseOrderController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $page = max(1, (int) $request->query('page', 1));
        $pageSize = min(100, max(1, (int) $request->query('page_size', 20)));
        $status = $request->query('status');
        $search = trim((string) $request->query('search', ''));

        $q = PackagingLicenseOrder::query();
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
            'items' => $rows->map(fn (PackagingLicenseOrder $o) => $this->formatOrder($o)),
        ]);
    }

    public function show(int $id): JsonResponse
    {
        $order = PackagingLicenseOrder::find($id);
        if (!$order) {
            return response()->json(['error' => 'order_not_found'], 404);
        }
        $data = $this->formatOrder($order);
        $data['notify_payload'] = $order->notify_payload;
        return response()->json($data);
    }

    public function sync(int $id, WeChatPayService $wxpay, PackagingPurchaseController $purchase): JsonResponse
    {
        $order = PackagingLicenseOrder::find($id);
        if (!$order) {
            return response()->json(['error' => 'order_not_found'], 404);
        }
        if (!$wxpay->isConfigured()) {
            return response()->json(['error' => 'wechat_pay_unconfigured'], 503);
        }

        try {
            $tx = $wxpay->queryOrder($order->order_no);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'wxpay_query_failed', 'message' => $e->getMessage()], 502);
        }

        $tradeState = (string) ($tx['trade_state'] ?? '');
        if ($tradeState === 'SUCCESS' && $order->status === PackagingLicenseOrder::STATUS_PENDING) {
            DB::transaction(function () use ($purchase, $order, $tx) {
                $purchase->settlePaid($order->order_no, $tx);
            });
            $order = $order->fresh();
        }

        return response()->json([
            'wx_trade_state' => $tradeState,
            'order' => $this->formatOrder($order),
        ]);
    }

    public function close(int $id, WeChatPayService $wxpay): JsonResponse
    {
        $order = PackagingLicenseOrder::find($id);
        if (!$order) {
            return response()->json(['error' => 'order_not_found'], 404);
        }
        if ($order->status !== PackagingLicenseOrder::STATUS_PENDING) {
            return response()->json(['error' => 'not_pending', 'status' => $order->status], 409);
        }

        if ($wxpay->isConfigured()) {
            try {
                $wxpay->closeOrder($order->order_no);
            } catch (\Throwable $e) {
                Log::warning('[packaging-self-serve] wx closeOrder failed: ' . $e->getMessage());
            }
        }

        PackagingLicenseOrder::assertTransition($order->status, PackagingLicenseOrder::STATUS_CLOSED);
        $order->status = PackagingLicenseOrder::STATUS_CLOSED;
        $order->closed_at = now();
        $order->save();

        return response()->json([
            'status' => $order->status,
            'order' => $this->formatOrder($order),
        ]);
    }

    private function formatOrder(PackagingLicenseOrder $order): array
    {
        return [
            'id' => $order->id,
            'order_no' => $order->order_no,
            'client_id' => $order->client_id,
            'domain' => $order->domain,
            'features' => (array) $order->features,
            'amount' => (string) $order->amount,
            'currency' => $order->currency,
            'status' => $order->derivedStatus(),
            'channel' => $order->channel,
            'code_url' => $order->code_url,
            'wx_transaction_id' => $order->wx_transaction_id,
            'expires_at' => optional($order->expires_at)->toIso8601String(),
            'paid_at' => optional($order->paid_at)->toIso8601String(),
            'closed_at' => optional($order->closed_at)->toIso8601String(),
            'created_at' => optional($order->created_at)->toIso8601String(),
            'remark' => $order->remark,
        ];
    }
}
