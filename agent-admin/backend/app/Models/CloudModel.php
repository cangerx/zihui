<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CloudModel extends Model
{
    protected $fillable = [
        'provider_id', 'model_id', 'name', 'type', 'status', 'remark',
    ];

    public function provider()
    {
        return $this->belongsTo(CloudProvider::class, 'provider_id');
    }

    public function assignments()
    {
        return $this->hasMany(ModelAssignment::class, 'cloud_model_id');
    }

    public function billingRules()
    {
        return $this->hasMany(BillingRule::class, 'cloud_model_id');
    }
}
