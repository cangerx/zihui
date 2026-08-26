<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CloudBuildAttempt extends Model
{
    protected $table = 'cloud_build_attempts';

    protected $fillable = [
        'build_id',
        'attempt_no',
        'outcome',
        'executor_run_id',
        'queued_at',
        'started_at',
        'finished_at',
        'error_message',
    ];

    protected $casts = [
        'attempt_no' => 'integer',
        'executor_run_id' => 'integer',
        'queued_at' => 'datetime',
        'started_at' => 'datetime',
        'finished_at' => 'datetime',
    ];

    public function job(): BelongsTo
    {
        return $this->belongsTo(CloudBuildJob::class, 'build_id', 'build_id');
    }
}
