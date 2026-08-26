<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class VideoProviderAccount extends Model
{
    protected $fillable = [
        'provider_key', 'name', 'base_url', 'api_key', 'auth_style', 'status',
        'config', 'last_test_at', 'last_test_status', 'last_test_message', 'remark',
    ];

    protected $hidden = ['api_key'];

    protected $casts = [
        'config' => 'array',
        'last_test_at' => 'datetime',
    ];

    public function tasks()
    {
        return $this->hasMany(VideoTask::class, 'video_provider_account_id');
    }
}
