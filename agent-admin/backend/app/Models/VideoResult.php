<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class VideoResult extends Model
{
    protected $fillable = [
        'video_task_id', 'user_id', 'remote_url', 'storage_url', 'cover_url',
        'duration_seconds', 'width', 'height', 'mime_type', 'file_size', 'storage_status', 'metadata',
    ];

    protected $casts = [
        'duration_seconds' => 'integer',
        'width' => 'integer',
        'height' => 'integer',
        'file_size' => 'integer',
        'metadata' => 'array',
    ];

    public function task()
    {
        return $this->belongsTo(VideoTask::class, 'video_task_id');
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
