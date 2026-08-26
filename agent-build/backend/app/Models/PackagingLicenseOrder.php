<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class PackagingLicenseOrder extends Model
{
    protected $table = 'packaging_license_orders';

    protected $fillable = [
        'order_no',
        'client_id',
        'domain',
        'features',
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
        'features' => 'array',
        'amount' => 'decimal:2',
        'expires_at' => 'datetime',
        'paid_at' => 'datetime',
        'closed_at' => 'datetime',
    ];

    public const STATUS_PENDING = 'pending';
    public const STATUS_PAID = 'paid';
    public const STATUS_CLOSED = 'closed';
    public const STATUS_FAILED = 'failed';

    public const TRANSITIONS = [
        self::STATUS_PENDING => [self::STATUS_PAID, self::STATUS_CLOSED, self::STATUS_FAILED],
    ];

    public function isExpired(): bool
    {
        if ($this->status !== self::STATUS_PENDING) {
            return false;
        }
        return $this->expires_at && $this->expires_at->lt(now());
    }

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

    public static function generateOrderNo(): string
    {
        return 'PKG' . now()->format('YmdHis') . strtoupper(Str::random(8));
    }
}
