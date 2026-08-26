<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class VideoUsageRecord extends Model
{
    protected $fillable = [
        'video_task_id', 'user_id', 'video_model_spec_id', 'video_sku_price_id',
        'provider_key', 'provider_protocol', 'model_id', 'sku_key', 'credits_used',
        'balance_type', 'source_plan_id', 'status', 'request_id', 'remark', 'billing_snapshot',
    ];

    protected $casts = [
        'credits_used' => 'float',
        'billing_snapshot' => 'array',
    ];

    public function task()
    {
        return $this->belongsTo(VideoTask::class, 'video_task_id');
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function modelSpec()
    {
        return $this->belongsTo(VideoModelSpec::class, 'video_model_spec_id');
    }

    public function sku()
    {
        return $this->belongsTo(VideoSkuPrice::class, 'video_sku_price_id');
    }
}
