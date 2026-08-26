<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BillingRule extends Model
{
    protected $fillable = [
        'cloud_model_id', 'target_type', 'target_id',
        'billing_type', 'input_price', 'output_price', 'credit_per_call',
    ];

    protected $casts = [
        'input_price' => 'decimal:8',
        'output_price' => 'decimal:8',
        'credit_per_call' => 'decimal:4',
    ];

    public function cloudModel()
    {
        return $this->belongsTo(CloudModel::class, 'cloud_model_id');
    }

    public function target()
    {
        return $this->morphTo();
    }
}
