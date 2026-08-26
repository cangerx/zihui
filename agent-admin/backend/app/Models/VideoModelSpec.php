<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class VideoModelSpec extends Model
{
    protected $fillable = [
        'provider_key', 'provider_protocol', 'model_id', 'display_name', 'generation_type',
        'status', 'supported_modes', 'supported_durations', 'supported_resolutions',
        'supported_aspect_ratios', 'max_reference_images', 'provider_params', 'description', 'sort_order',
    ];

    protected $casts = [
        'supported_modes' => 'array',
        'supported_durations' => 'array',
        'supported_resolutions' => 'array',
        'supported_aspect_ratios' => 'array',
        'provider_params' => 'array',
        'max_reference_images' => 'integer',
        'sort_order' => 'integer',
    ];

    public function skus()
    {
        return $this->hasMany(VideoSkuPrice::class, 'video_model_spec_id');
    }

    public function tasks()
    {
        return $this->hasMany(VideoTask::class, 'video_model_spec_id');
    }
}
