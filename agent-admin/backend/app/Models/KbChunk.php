<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class KbChunk extends Model
{
    protected $fillable = [
        'kb_id', 'document_id', 'chunk_idx', 'chunk_text',
        'embedding_model', 'vec_indexed', 'token_count',
    ];

    protected $casts = [
        'kb_id'       => 'integer',
        'document_id' => 'integer',
        'chunk_idx'   => 'integer',
        'vec_indexed' => 'boolean',
        'token_count' => 'integer',
    ];

    public function document(): BelongsTo
    {
        return $this->belongsTo(KbDocument::class, 'document_id');
    }

    public function knowledgeBase(): BelongsTo
    {
        return $this->belongsTo(KnowledgeBase::class, 'kb_id');
    }
}
