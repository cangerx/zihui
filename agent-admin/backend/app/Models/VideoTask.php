<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class VideoTask extends Model
{
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'id', 'user_id', 'video_provider_account_id', 'video_model_spec_id', 'video_sku_price_id',
        'provider_key', 'provider_protocol', 'model_id', 'sku_key', 'request_id', 'provider_task_id',
        'status', 'provider_status', 'progress', 'prompt', 'negative_prompt', 'input_assets',
        'request_params', 'submit_payload', 'provider_response', 'billing_snapshot', 'billing_status',
        'estimated_credits', 'credits_used', 'error_code', 'error_message', 'submitted_at',
        'completed_at', 'failed_at',
    ];

    protected $casts = [
        'input_assets' => 'array',
        'request_params' => 'array',
        'submit_payload' => 'array',
        'provider_response' => 'array',
        'billing_snapshot' => 'array',
        'progress' => 'integer',
        'estimated_credits' => 'float',
        'credits_used' => 'float',
        'submitted_at' => 'datetime',
        'completed_at' => 'datetime',
        'failed_at' => 'datetime',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function account()
    {
        return $this->belongsTo(VideoProviderAccount::class, 'video_provider_account_id');
    }

    public function modelSpec()
    {
        return $this->belongsTo(VideoModelSpec::class, 'video_model_spec_id');
    }

    public function sku()
    {
        return $this->belongsTo(VideoSkuPrice::class, 'video_sku_price_id');
    }

    public function result()
    {
        return $this->hasOne(VideoResult::class, 'video_task_id');
    }

    public function usageRecord()
    {
        return $this->hasOne(VideoUsageRecord::class, 'video_task_id');
    }
}
