<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * 自助付费开通商城授权 —— 订单。
 *
 * 状态机：pending → paid / closed / failed（无退款流程，退款需在微信商户平台手工处理）。
 * mall_keys 记录本单要开通的商城；回调成功后逐个写 client_mall_authorizations 授权位。
 */
class SelfServeOrder extends Model
{
    protected $table = 'self_serve_orders';

    protected $fillable = [
        'order_no',
        'client_id',
        'domain',
        'mall_keys',
        'amount',
        'currency',
        'status',
        'channel',
        'code_url',
        'wx_transaction_id',
        'notify_payload',
        'client_ip',
        'remark',
        'expires_at',
        'paid_at',
        'closed_at',
    ];

    protected $casts = [
        'mall_keys'  => 'array',
        'amount'     => 'decimal:2',
        'expires_at' => 'datetime',
        'paid_at'    => 'datetime',
        'closed_at'  => 'datetime',
    ];

    public const STATUS_PENDING = 'pending';
    public const STATUS_PAID    = 'paid';
    public const STATUS_CLOSED  = 'closed';
    public const STATUS_FAILED  = 'failed';

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

    /** 生成订单号：MALL + 紧凑时间戳 + 8 位大写随机。 */
    public static function generateOrderNo(): string
    {
        return 'MALL' . now()->format('YmdHis') . strtoupper(Str::random(8));
    }
}
