<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TemporaryReferenceAsset extends Model
{
    protected $fillable = [
        'user_id', 'video_task_id', 'asset_type', 'source', 'original_url', 'storage_url',
        'storage_driver', 'mime_type', 'file_size', 'status', 'expires_at', 'metadata',
    ];

    protected $casts = [
        'file_size' => 'integer',
        'expires_at' => 'datetime',
        'metadata' => 'array',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function task()
    {
        return $this->belongsTo(VideoTask::class, 'video_task_id');
    }
}
