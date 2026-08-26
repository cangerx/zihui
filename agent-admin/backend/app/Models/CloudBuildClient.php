<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CloudBuildClient extends Model
{
    protected $table = 'cloud_build_clients';

    protected $fillable = [
        'client_ref',
        'domain',
        'daily_limit',
        'monthly_limit',
        'status',
        'expires_at',
        'maintenance_exempt',
    ];

    protected $casts = [
        'daily_limit' => 'integer',
        'monthly_limit' => 'integer',
        'expires_at' => 'datetime',
        'maintenance_exempt' => 'boolean',
    ];
}
