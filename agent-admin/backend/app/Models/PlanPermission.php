<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PlanPermission extends Model
{
    protected $fillable = ['plan_id', 'policy_key', 'policy_value'];

    public function plan()
    {
        return $this->belongsTo(Plan::class);
    }
}
