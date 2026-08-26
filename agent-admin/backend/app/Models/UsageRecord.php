<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UsageRecord extends Model
{
    protected $fillable = [
        'user_id', 'cloud_model_id', 'type',
        'prompt_tokens', 'completion_tokens', 'total_tokens',
        'credits_used', 'cost', 'balance_type', 'source_plan_id', 'status', 'request_id', 'remark',
    ];

    protected $casts = [
        'credits_used' => 'decimal:4',
        'cost' => 'decimal:8',
        'prompt_tokens' => 'integer',
        'completion_tokens' => 'integer',
        'total_tokens' => 'integer',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function cloudModel()
    {
        return $this->belongsTo(CloudModel::class, 'cloud_model_id');
    }

    public function sourcePlan()
    {
        return $this->belongsTo(UserPlan::class, 'source_plan_id');
    }
}
