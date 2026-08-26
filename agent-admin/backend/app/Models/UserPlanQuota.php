<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UserPlanQuota extends Model
{
    protected $fillable = [
        'user_id', 'user_plan_id', 'plan_id', 'balance_type', 'granted', 'consumed', 'expires_at', 'status',
    ];

    protected $casts = [
        'granted' => 'decimal:4',
        'consumed' => 'decimal:4',
        'expires_at' => 'datetime',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function userPlan()
    {
        return $this->belongsTo(UserPlan::class);
    }

    public function plan()
    {
        return $this->belongsTo(Plan::class);
    }

    public function getRemainingAttribute(): float
    {
        return max(0, (float)$this->granted - (float)$this->consumed);
    }
}
