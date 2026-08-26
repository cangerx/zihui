<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UserGroup extends Model
{
    protected $fillable = ['name', 'description', 'is_default'];

    protected $casts = [
        'is_default' => 'boolean',
    ];

    public function members()
    {
        return $this->belongsToMany(User::class, 'user_group_members', 'group_id', 'user_id');
    }

    public function modelAssignments()
    {
        return $this->morphMany(ModelAssignment::class, 'assignee');
    }

    public function permissionPolicies()
    {
        return $this->morphMany(PermissionPolicy::class, 'target');
    }

    public function billingRules()
    {
        return $this->morphMany(BillingRule::class, 'target');
    }
}
