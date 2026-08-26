<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AgentVisibility extends Model
{
    public const ASSIGNEE_USER = 'user';
    public const ASSIGNEE_GROUP = 'group';

    protected $fillable = [
        'agent_id',
        'assignee_type',
        'assignee_id',
    ];

    protected $casts = [
        'agent_id' => 'integer',
        'assignee_id' => 'integer',
    ];

    public function agent(): BelongsTo
    {
        return $this->belongsTo(Agent::class, 'agent_id');
    }
}
