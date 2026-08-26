<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class KnowledgeBase extends Model
{
    public const STATUS_ACTIVE = 'active';
    public const STATUS_DISABLED = 'disabled';

    public const VISIBILITY_PUBLIC = 'public';
    public const VISIBILITY_RESTRICTED = 'restricted';

    protected $fillable = [
        'name', 'description', 'visibility_scope', 'embedding_model_id',
        'status', 'doc_count', 'chunk_count', 'is_visible', 'sort_order',
        'created_by_user_id',
    ];

    protected $casts = [
        'embedding_model_id' => 'integer',
        'doc_count'          => 'integer',
        'chunk_count'        => 'integer',
        'is_visible'         => 'boolean',
        'sort_order'         => 'integer',
        'created_by_user_id' => 'integer',
    ];

    public function documents(): HasMany
    {
        return $this->hasMany(KbDocument::class, 'kb_id');
    }

    public function chunks(): HasMany
    {
        return $this->hasMany(KbChunk::class, 'kb_id');
    }

    public function agents(): BelongsToMany
    {
        return $this->belongsToMany(
            Agent::class,
            'agent_knowledge_bases',
            'knowledge_base_id',
            'agent_id'
        )->withTimestamps();
    }
}
