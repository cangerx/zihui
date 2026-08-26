<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BalanceLog extends Model
{
    protected $fillable = [
        'user_id', 'balance_type', 'change_amount', 'balance_after',
        'change_type', 'remark', 'operator_id', 'source_plan_id', 'request_id',
    ];

    protected $casts = [
        'change_amount' => 'decimal:4',
        'balance_after' => 'decimal:4',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function operator()
    {
        return $this->belongsTo(User::class, 'operator_id');
    }

    public function sourcePlan()
    {
        return $this->belongsTo(UserPlan::class, 'source_plan_id');
    }
}
