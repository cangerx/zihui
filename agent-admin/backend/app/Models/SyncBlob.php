<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SyncBlob extends Model
{
    protected $fillable = [
        'user_id', 'sha256', 'size', 'category', 'storage_driver',
        'storage_url', 'status',
    ];

    protected $casts = [
        'size' => 'integer',
    ];
}
