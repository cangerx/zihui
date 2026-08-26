<?php

namespace App\Console\Commands;

use App\Models\PaymentOrder;
use App\Services\WeChatPayService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * 关闭已过期但仍处于 pending 状态的支付订单：
 * - 调微信 close API 通知微信侧关单（失败不阻塞）
 * - 本地状态置为 closed 并记录 closed_at
 *
 * 由 Kernel 每 5 分钟调度一次。
 */
class CloseExpiredOrders extends Command
{
    protected $signature = 'order:close-expired {--limit=200 : Max orders to close per run}';
    protected $description = 'Close expired pending payment orders';

    public function handle(WeChatPayService $wxpay)
    {
        $limit  = (int)$this->option('limit');

        // 顺便清理 7 天前的 failed 订单（下单阶段微信报错产生的脏数据）
        $purged = PaymentOrder::where('status', PaymentOrder::STATUS_FAILED)
            ->where('created_at', '<', now()->subDays(7))
            ->limit($limit)
            ->delete();
        if ($purged > 0) {
            $this->info("Purged {$purged} stale failed order(s).");
        }

        $orders = PaymentOrder::where('status', PaymentOrder::STATUS_PENDING)
            ->where('expires_at', '<', now())
            ->orderBy('id')
            ->limit($limit)
            ->get();

        if ($orders->isEmpty()) {
            $this->info('No expired orders to close.');
            return 0;
        }

        $closed = 0;
        foreach ($orders as $order) {
            // 微信侧 close 失败不阻塞本地关单（订单本身已过期）
            try {
                if ($wxpay->isConfigured()) {
                    $wxpay->closeOrder($order->order_no);
                }
            } catch (\Throwable $e) {
                Log::warning("[order:close-expired] wxpay close failed order={$order->order_no}: " . $e->getMessage());
            }

            try {
                PaymentOrder::assertTransition($order->status, PaymentOrder::STATUS_CLOSED);
                $order->status    = PaymentOrder::STATUS_CLOSED;
                $order->closed_at = now();
                $order->save();
                $closed++;
            } catch (\Throwable $e) {
                $this->error(sprintf(
                    'Failed to close order #%d (%s): %s',
                    $order->id,
                    $order->order_no,
                    $e->getMessage()
                ));
            }
        }

        $this->info("Closed {$closed} expired order(s).");
        return 0;
    }
}
