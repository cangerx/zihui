<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SharedAgentReview extends Model
{
    protected $table = 'shared_agent_reviews';

    public $timestamps = false;

    protected $fillable = [
        'shared_id',
        'reviewer_client_id',
        'action',
        'reason',
        'created_at',
    ];

    protected $casts = [
        'created_at' => 'datetime',
    ];

    public function agent(): BelongsTo
    {
        return $this->belongsTo(SharedAgent::class, 'shared_id');
    }
}
