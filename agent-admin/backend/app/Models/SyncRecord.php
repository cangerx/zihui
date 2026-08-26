<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SyncRecord extends Model
{
    protected $fillable = [
        'user_id', 'server_seq', 'entity', 'sync_uid', 'rev', 'deleted',
        'content_hash', 'updated_ms', 'origin_device', 'payload',
    ];

    protected $casts = [
        'deleted' => 'boolean',
        'rev' => 'integer',
        'server_seq' => 'integer',
        'updated_ms' => 'integer',
    ];
}
