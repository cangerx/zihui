<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Inspiration extends Model
{
    public const STATUS_PENDING  = 'pending';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_REJECTED = 'rejected';

    protected $fillable = [
        'category_id', 'title', 'cover_image', 'cover_thumb', 'ref_images', 'generation_size', 'prompt_cn', 'prompt_en', 'sort_order',
        'uploader_user_id', 'uploader_nickname', 'status', 'is_visible',
        // 共享灵感库（agent-build hub）相关字段
        'hub_shared_id', 'hub_status', 'hub_status_synced_at',
        'from_hub_inspiration_id', 'from_hub_source_site_name',
    ];

    protected $casts = [
        'ref_images' => 'array',
        'is_visible' => 'boolean',
        'hub_shared_id' => 'integer',
        'hub_status_synced_at' => 'datetime',
        'from_hub_inspiration_id' => 'integer',
    ];

    public function category(): BelongsTo
    {
        return $this->belongsTo(InspirationCategory::class, 'category_id');
    }
}
