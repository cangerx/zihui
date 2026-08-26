<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SharedAgentReport extends Model
{
    protected $table = 'shared_agent_reports';

    public $timestamps = false;

    protected $fillable = [
        'shared_id',
        'reporter_client_id',
        'reason_code',
        'reason_note',
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
