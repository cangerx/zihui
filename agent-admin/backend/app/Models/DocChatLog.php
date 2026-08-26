<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DocChatLog extends Model
{
    public const STATUS_SUCCESS  = 'success';
    public const STATUS_FAILED   = 'failed';
    public const STATUS_NO_MATCH = 'no_match';

    protected $fillable = [
        'user_id', 'session_id', 'query', 'answer',
        'cited_doc_ids', 'latency_ms', 'total_tokens',
        'status', 'error',
    ];

    protected $casts = [
        'cited_doc_ids' => 'array',
        'latency_ms'    => 'integer',
        'total_tokens'  => 'integer',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
