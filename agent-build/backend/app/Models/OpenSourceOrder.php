<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * 开源交付 —— 订单。
 *
 * 状态机：pending → paid / closed / failed（无退款流程，退款在微信商户平台手工处理）。
 * 与商城授权单不同，本单支付成功后不自动开通任何权限，交付由运营人工完成（拉群 / 发代码包 /
 * 发规则文档），delivered 字段供后台标记交付进度。
 */
class OpenSourceOrder extends Model
{
    protected $table = 'open_source_orders';

    protected $fillable = [
        'order_no',
        'tier',
        'buyer_name',
        'buyer_phone',
        'buyer_wechat',
        'buyer_email',
        'buyer_domain',
        'amount',
        'currency',
        'status',
        'channel',
        'code_url',
        'wx_transaction_id',
        'notify_payload',
        'delivered',
        'delivered_at',
        'client_ip',
        'remark',
        'expires_at',
        'paid_at',
        'closed_at',
    ];

    protected $casts = [
        'amount'       => 'decimal:2',
        'delivered'    => 'boolean',
        'delivered_at' => 'datetime',
        'expires_at'   => 'datetime',
        'paid_at'      => 'datetime',
        'closed_at'    => 'datetime',
    ];

    public const STATUS_PENDING = 'pending';
    public const STATUS_PAID    = 'paid';
    public const STATUS_CLOSED  = 'closed';
    public const STATUS_FAILED  = 'failed';

    /** 交付档位：当前仅先锋开源为付费档。 */
    public const TIER_PIONEER = 'pioneer';

    /** 仅允许如下状态转移。 */
    public const TRANSITIONS = [
        self::STATUS_PENDING => [self::STATUS_PAID, self::STATUS_CLOSED, self::STATUS_FAILED],
    ];

    public function isPending(): bool
    {
        return $this->status === self::STATUS_PENDING;
    }

    public function isExpired(): bool
    {
        if ($this->status !== self::STATUS_PENDING) {
            return false;
        }
        return $this->expires_at && $this->expires_at->lt(now());
    }

    /** 对外 derived 状态：pending 但已过期 → expired。 */
    public function derivedStatus(): string
    {
        if ($this->isExpired()) {
            return 'expired';
        }
        return $this->status;
    }

    public static function assertTransition(string $from, string $to): void
    {
        $allowed = self::TRANSITIONS[$from] ?? [];
        if (!in_array($to, $allowed, true)) {
            throw new \InvalidArgumentException("非法状态转移: {$from} → {$to}");
        }
    }

    /** 生成订单号：OPEN + 紧凑时间戳 + 8 位大写随机。 */
    public static function generateOrderNo(): string
    {
        return 'OPEN' . now()->format('YmdHis') . strtoupper(Str::random(8));
    }
}
