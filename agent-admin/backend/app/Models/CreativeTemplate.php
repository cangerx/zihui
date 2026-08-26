<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CreativeTemplate extends Model
{
    public const SOURCE_MANUAL = 'manual';
    public const SOURCE_IMAGE = 'image';
    public const SOURCE_INSPIRATION = 'inspiration';
    public const STATUS_PENDING = 'pending';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_REJECTED = 'rejected';
    public const STATUS_WITHDRAWN = 'withdrawn';

    protected $fillable = [
        'category_id',
        'title',
        'description',
        'cover_image',
        'cover_thumb',
        'example_ref_images',
        'requires_ref_image',
        'default_size',
        'prompt_template',
        'variables',
        'source_type',
        'source_image',
        'source_inspiration_id',
        'source_metadata',
        'sort_order',
        'is_visible',
        'hub_shared_id',
        'hub_status',
        'hub_status_synced_at',
        'from_hub_template_id',
        'from_hub_source_site_name',
        'created_by_user_id',
        'submission_status',
        'submitted_by_user_id',
        'submitted_by_nickname',
        'reviewed_by_user_id',
        'reviewed_at',
        'reject_reason',
        'source_local_template_id',
        'submitted_at',
        'published_at',
    ];

    protected $casts = [
        'example_ref_images' => 'array',
        'variables' => 'array',
        'source_metadata' => 'array',
        'requires_ref_image' => 'boolean',
        'is_visible' => 'boolean',
        'hub_shared_id' => 'integer',
        'hub_status_synced_at' => 'datetime',
        'from_hub_template_id' => 'integer',
        'source_inspiration_id' => 'integer',
        'created_by_user_id' => 'integer',
        'submitted_by_user_id' => 'integer',
        'reviewed_by_user_id' => 'integer',
        'reviewed_at' => 'datetime',
        'submitted_at' => 'datetime',
        'published_at' => 'datetime',
    ];

    public function category(): BelongsTo
    {
        return $this->belongsTo(CreativeTemplateCategory::class, 'category_id');
    }

    public function sourceInspiration(): BelongsTo
    {
        return $this->belongsTo(Inspiration::class, 'source_inspiration_id');
    }

    public function submittedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'submitted_by_user_id');
    }
}
