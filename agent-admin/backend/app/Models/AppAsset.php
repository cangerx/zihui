<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AppAsset extends Model
{
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'id', 'user_id', 'kind', 'original_name', 'storage_driver', 'object_key', 'storage_url',
        'declared_mime', 'detected_mime', 'expected_size', 'actual_size', 'sha256', 'status',
        'expires_at', 'upload_expires_at', 'nonce_hash', 'consumed_at', 'lease_until',
    ];

    protected $casts = [
        'expected_size' => 'integer',
        'actual_size' => 'integer',
        'expires_at' => 'datetime',
        'upload_expires_at' => 'datetime',
        'consumed_at' => 'datetime',
        'lease_until' => 'datetime',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
