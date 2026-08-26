<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PermissionPolicy extends Model
{
    protected $fillable = [
        'target_type', 'target_id', 'policy_key', 'policy_value', 'source_plan_id',
    ];

    protected $casts = [
        'policy_value' => 'json',
    ];

    public function target()
    {
        return $this->morphTo();
    }
}
