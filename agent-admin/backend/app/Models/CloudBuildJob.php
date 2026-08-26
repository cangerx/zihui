<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class CloudBuildJob extends Model
{
    protected $table = 'cloud_build_jobs';

    protected $fillable = [
        'build_id',
        'client_ref',
        'build_mode',
        'oem_project_key',
        'platform',
        'app_name',
        'app_version',
        'app_id',
        'update_path',
        'build_options',
        'callback_token',
        'icon_path',
        'release_tag',
        'release_assets',
        'phase',
        'source_status',
        'source_mirror_status',
        'claim_owner',
        'claimed_at',
        'dispatch_attempts',
        'executor_id',
        'executor_run_id',
        'error_message',
        'queued_at',
        'dispatched_at',
        'started_at',
        'finished_at',
        'delivered_at',
        'purged_at',
        'mirror_assigned_at',
        'mirror_url_primary',
    ];

    protected $casts = [
        'claimed_at' => 'datetime',
        'queued_at' => 'datetime',
        'dispatched_at' => 'datetime',
        'started_at' => 'datetime',
        'finished_at' => 'datetime',
        'delivered_at' => 'datetime',
        'purged_at' => 'datetime',
        'mirror_assigned_at' => 'datetime',
        'dispatch_attempts' => 'integer',
        'executor_run_id' => 'integer',
        'release_assets' => 'array',
    ];

    protected $hidden = [
        'callback_token',
    ];

    public function attempts(): HasMany
    {
        return $this->hasMany(CloudBuildAttempt::class, 'build_id', 'build_id');
    }

    public function artifacts(): HasMany
    {
        return $this->hasMany(CloudBuildArtifact::class, 'build_id', 'build_id');
    }
}
