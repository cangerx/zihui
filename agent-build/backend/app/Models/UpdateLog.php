<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UpdateLog extends Model
{
    protected $table = 'update_logs';

    protected $fillable = [
        'from_version', 'to_version', 'status', 'phase', 'progress_percent',
        'log', 'error_message', 'zip_url', 'zip_sha256', 'zip_size',
        'backup_path', 'operator_id', 'operator_name',
        'started_at', 'finished_at', 'duration_seconds',
    ];

    protected $casts = [
        'progress_percent' => 'integer',
        'zip_size' => 'integer',
        'duration_seconds' => 'integer',
        'started_at' => 'datetime',
        'finished_at' => 'datetime',
    ];

    public const STATUS_RUNNING = 'running';
    public const STATUS_SUCCESS = 'success';
    public const STATUS_FAILED = 'failed';
}
