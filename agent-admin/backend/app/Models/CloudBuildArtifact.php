<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CloudBuildArtifact extends Model
{
    protected $table = 'cloud_build_artifacts';

    protected $fillable = [
        'build_id',
        'filename',
        'role',
        'size',
        'sha256',
        'storage_path',
        'mirror_url',
        'fetch_attempts',
    ];

    protected $casts = [
        'size' => 'integer',
        'fetch_attempts' => 'integer',
    ];

    public function job(): BelongsTo
    {
        return $this->belongsTo(CloudBuildJob::class, 'build_id', 'build_id');
    }
}
