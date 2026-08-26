<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * 支付订单。
 *
 * ⚠～退款说明～
 * 字段 refund_amount / wx_refund_id / wx_refund_no / refund_at / refund_reason 为 **DB schema 预留**，
 * 状态机中 STATUS_REFUNDED 与 paid → refunded 转移仅为数据模型占位，
 * **所有退款业务流程均未实现**：
 *   - 未接入微信退款 API（POST /v3/refund/domestic/refunds）
 *   - 未注册退款回调 notify_url
 *   - 未提供管理端退款操作入口
 *   - WeChatPayService 中无 refund 相关方法
 *
 * 如需退款，当前只能手工：
 *   1) 在微信商户平台发起退款
 *   2) 手工 UPDATE 本库订单为 refunded（受 assertTransition 约束）
 *
 * 后续恢复完整退款能力时，需同步实现上述 4 项。
 */
class PaymentOrder extends Model
{
    protected $fillable = [
        'order_no',
        'user_id',
        'plan_id',
        'plan_snapshot',
        'amount',
        'currency',
        'channel',
        'oem_project_key',
        'commission_user_id',
        'commission_rate_snapshot',
        'commission_amount',
        'commission_status',
        'order_type',
        'status',
        'wx_prepay_id',
        'wx_transaction_id',
        'code_url',
        'notify_payload',
        'user_plan_id',
        'upgrade_from_user_plan_id',
        'paid_at',
        'closed_at',
        'expires_at',
        'refund_amount',
        'refund_at',
        'refund_reason',
        'wx_refund_id',
        'remark',
        'client_ip',
    ];

    protected $casts = [
        'plan_snapshot'  => 'array',
        'amount'         => 'decimal:2',
        'commission_rate_snapshot' => 'decimal:4',
        'commission_amount' => 'decimal:2',
        'refund_amount'  => 'decimal:2',
        'paid_at'        => 'datetime',
        'closed_at'      => 'datetime',
        'expires_at'     => 'datetime',
        'refund_at'      => 'datetime',
    ];

    public const STATUS_PENDING  = 'pending';
    public const STATUS_PAID     = 'paid';
    public const STATUS_CLOSED   = 'closed';
    public const STATUS_FAILED   = 'failed';
    /** ⚠ schema 预留状态：详见本类顶部「退款说明」 */
    public const STATUS_REFUNDED = 'refunded';
    public const TYPE_PURCHASE = 'purchase';
    public const TYPE_UPGRADE = 'upgrade';
    public const TYPE_RENEW = 'renew';
    public const TYPE_RECHARGE = 'recharge';

    /**
     * 状态机：仅允许如下转移。
     *
     * paid → refunded 为预留转移，当前仅存在于状态机定义，
     * 业务代码中无调用点（退款未实现）。
     */
    public const TRANSITIONS = [
        self::STATUS_PENDING => [self::STATUS_PAID, self::STATUS_CLOSED, self::STATUS_FAILED],
        self::STATUS_PAID    => [self::STATUS_REFUNDED],
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function plan()
    {
        return $this->belongsTo(Plan::class);
    }

    public function userPlan()
    {
        return $this->belongsTo(UserPlan::class, 'user_plan_id');
    }

    public function upgradeFromUserPlan()
    {
        return $this->belongsTo(UserPlan::class, 'upgrade_from_user_plan_id');
    }

    public function commissionRecord()
    {
        return $this->hasOne(OemCommissionRecord::class, 'order_id');
    }

    public function isPending(): bool
    {
        return $this->status === self::STATUS_PENDING;
    }

    public function isPaid(): bool
    {
        return $this->status === self::STATUS_PAID;
    }

    public function isExpired(): bool
    {
        if ($this->status !== self::STATUS_PENDING) return false;
        return $this->expires_at && $this->expires_at->lt(now());
    }

    /**
     * 计算对外暴露的 derived status：
     * - pending 但已过期 → 显示为 expired
     * - 其余按数据库原值
     */
    public function derivedStatus(): string
    {
        if ($this->isExpired()) return 'expired';
        return $this->status;
    }

    /**
     * 校验状态转移是否合法，非法时抛异常。
     */
    public static function assertTransition(string $from, string $to): void
    {
        $allowed = self::TRANSITIONS[$from] ?? [];
        if (!in_array($to, $allowed, true)) {
            throw new \InvalidArgumentException("非法状态转移: {$from} → {$to}");
        }
    }

    /**
     * 生成订单号：PO + 时间戳紧凑形式 + 8 位大写随机
     */
    public static function generateOrderNo(): string
    {
        return 'PO' . now()->format('YmdHis') . strtoupper(\Illuminate\Support\Str::random(8));
    }
}
