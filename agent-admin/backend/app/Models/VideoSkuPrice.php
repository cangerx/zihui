<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class VideoSkuPrice extends Model
{
    protected $fillable = [
        'video_model_spec_id', 'sku_key', 'provider_key', 'provider_protocol', 'model_id',
        'title', 'mode', 'duration_seconds', 'resolution', 'aspect_ratio', 'quality',
        'default_credit_cost', 'price_label', 'provider_cost_text', 'provider_cost_source',
        'provider_params', 'status', 'sort_order',
    ];

    protected $casts = [
        'duration_seconds' => 'integer',
        'default_credit_cost' => 'float',
        'provider_params' => 'array',
        'sort_order' => 'integer',
    ];

    public function modelSpec()
    {
        return $this->belongsTo(VideoModelSpec::class, 'video_model_spec_id');
    }

    public function pricingRules()
    {
        return $this->hasMany(VideoPricingRule::class, 'video_sku_price_id');
    }
}
