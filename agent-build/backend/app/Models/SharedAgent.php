<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class SharedAgent extends Model
{
    protected $table = 'shared_agents';

    protected $fillable = [
        'category_id',
        'name',
        'description',
        'avatar',
        'system_prompt',
        'tool_skill_ids',
        'tool_approval',
        'enable_image_gen',
        'tags',
        'source_client_id',
        'source_local_id',
        'source_site_name',
        'source_metadata',
        'status',
        'is_visible',
        'reviewed_at',
        'auto_hidden_at',
        'approve_count',
        'reject_count',
        'report_count',
        'download_count',
    ];

    protected $casts = [
        'tool_skill_ids' => 'array',
        'tags' => 'array',
        'source_metadata' => 'array',
        'enable_image_gen' => 'boolean',
        'is_visible' => 'boolean',
        'approve_count' => 'integer',
        'reject_count' => 'integer',
        'report_count' => 'integer',
        'download_count' => 'integer',
        'reviewed_at' => 'datetime',
        'auto_hidden_at' => 'datetime',
    ];

    public function category(): BelongsTo
    {
        return $this->belongsTo(SharedAgentCategory::class, 'category_id');
    }

    public function reviews(): HasMany
    {
        return $this->hasMany(SharedAgentReview::class, 'shared_id');
    }

    public function reports(): HasMany
    {
        return $this->hasMany(SharedAgentReport::class, 'shared_id');
    }
}
