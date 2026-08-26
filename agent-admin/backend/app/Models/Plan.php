<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Plan extends Model
{
    protected $fillable = [
        'category_id', 'code', 'name', 'description', 'price', 'currency',
        'duration_days', 'token_quota', 'credit_quota', 'storage_quota_bytes',
        'quota_refill_cycle', 'rate_limit_json',
        'status', 'sort', 'remark',
    ];

    protected $casts = [
        'price'           => 'decimal:2',
        'token_quota'     => 'decimal:4',
        'credit_quota'    => 'decimal:4',
        'storage_quota_bytes' => 'integer',
        'category_id'     => 'integer',
        'duration_days'   => 'integer',
        'sort'            => 'integer',
        'rate_limit_json' => 'array',
    ];

    public function category()
    {
        return $this->belongsTo(PlanCategory::class, 'category_id');
    }

    public function modelAssignments()
    {
        return $this->hasMany(PlanModelAssignment::class, 'plan_id');
    }

    public function permissions()
    {
        return $this->hasMany(PlanPermission::class, 'plan_id');
    }

    public function userPlans()
    {
        return $this->hasMany(UserPlan::class, 'plan_id');
    }
}
