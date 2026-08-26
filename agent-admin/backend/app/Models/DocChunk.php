<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DocChunk extends Model
{
    protected $fillable = [
        'doc_id', 'chunk_idx', 'chunk_text',
        'embedding_model', 'vec_indexed', 'token_count',
    ];

    protected $casts = [
        'chunk_idx'   => 'integer',
        'vec_indexed' => 'boolean',
        'token_count' => 'integer',
    ];

    public function doc(): BelongsTo
    {
        return $this->belongsTo(Doc::class, 'doc_id');
    }
}
