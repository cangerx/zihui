<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AgentPurchase extends Model
{
    protected $fillable = [
        'agent_id',
        'user_id',
        'price',
        'balance_type',
        'purchased_at',
    ];

    protected $casts = [
        'agent_id' => 'integer',
        'user_id' => 'integer',
        'price' => 'decimal:2',
        'purchased_at' => 'datetime',
    ];

    public function agent(): BelongsTo
    {
        return $this->belongsTo(Agent::class, 'agent_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
