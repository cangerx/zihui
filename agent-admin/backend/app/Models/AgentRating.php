<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AgentRating extends Model
{
    protected $fillable = [
        'agent_id',
        'user_id',
        'score',
        'comment',
    ];

    protected $casts = [
        'agent_id' => 'integer',
        'user_id' => 'integer',
        'score' => 'integer',
    ];

    public function agent(): BelongsTo
    {
        return $this->belongsTo(Agent::class);
    }
}
