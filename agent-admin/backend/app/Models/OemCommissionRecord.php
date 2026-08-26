<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class OemCommissionRecord extends Model
{
    protected $fillable = [
        'order_id',
        'order_no',
        'oem_project_key',
        'user_id',
        'buyer_user_id',
        'plan_id',
        'order_type',
        'pay_channel',
        'order_amount',
        'commission_rate',
        'commission_amount',
        'status',
        'confirmed_at',
        'cancelled_at',
        'cancel_reason',
    ];

    protected $casts = [
        'order_amount' => 'decimal:2',
        'commission_rate' => 'decimal:4',
        'commission_amount' => 'decimal:2',
        'confirmed_at' => 'datetime',
        'cancelled_at' => 'datetime',
    ];

    public const STATUS_PENDING = 'pending';
    public const STATUS_CONFIRMED = 'confirmed';
    public const STATUS_SETTLED = 'settled';
    public const STATUS_CANCELLED = 'cancelled';

    public function order()
    {
        return $this->belongsTo(PaymentOrder::class, 'order_id');
    }

    public function user()
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function buyer()
    {
        return $this->belongsTo(User::class, 'buyer_user_id');
    }

    public function plan()
    {
        return $this->belongsTo(Plan::class, 'plan_id');
    }
}
