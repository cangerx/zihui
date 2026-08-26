<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class VideoPricingRule extends Model
{
    protected $fillable = [
        'video_sku_price_id', 'target_type', 'target_id', 'credit_cost', 'status', 'remark',
    ];

    protected $casts = [
        'credit_cost' => 'float',
        'target_id' => 'integer',
    ];

    public function sku()
    {
        return $this->belongsTo(VideoSkuPrice::class, 'video_sku_price_id');
    }
}
