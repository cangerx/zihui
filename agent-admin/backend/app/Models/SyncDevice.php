<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SyncDevice extends Model
{
    protected $fillable = [
        'user_id', 'device_id', 'name', 'last_seq', 'last_sync_at',
    ];

    protected $casts = [
        'last_seq' => 'integer',
        'last_sync_at' => 'datetime',
    ];
}
