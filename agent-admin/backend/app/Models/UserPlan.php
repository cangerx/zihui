<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UserPlan extends Model
{
    protected $fillable = [
        'user_id', 'plan_id', 'source', 'activated_at', 'expires_at',
        'quota_refill_cycle', 'last_quota_refilled_at', 'next_quota_refill_at',
        'status', 'token_granted', 'credit_granted', 'storage_granted', 'policy_snapshot_json',
        'remark', 'operator_id', 'upgraded_from_user_plan_id',
    ];

    protected $casts = [
        'activated_at'         => 'datetime',
        'expires_at'           => 'datetime',
        'last_quota_refilled_at' => 'datetime',
        'next_quota_refill_at' => 'datetime',
        'token_granted'        => 'decimal:4',
        'credit_granted'       => 'decimal:4',
        'storage_granted'      => 'integer',
        'policy_snapshot_json' => 'array',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function plan()
    {
        return $this->belongsTo(Plan::class);
    }

    public function quotas()
    {
        return $this->hasMany(UserPlanQuota::class);
    }

    public function operator()
    {
        return $this->belongsTo(User::class, 'operator_id');
    }

    public function upgradedFrom()
    {
        return $this->belongsTo(UserPlan::class, 'upgraded_from_user_plan_id');
    }

    public function isActive(): bool
    {
        if ($this->status !== 'active') return false;
        if ($this->expires_at && $this->expires_at->lt(now())) return false;
        return true;
    }
}
