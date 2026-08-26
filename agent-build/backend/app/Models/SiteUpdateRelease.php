<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SiteUpdateRelease extends Model
{
    public const CHANNEL_ADMIN = 'admin';

    protected $fillable = [
        'channel',
        'version',
        'changelog',
        'zip_path',
        'zip_url',
        'sha256',
        'size',
        'min_upgradable_from',
        'breaking',
        'is_current',
        'released_by',
        'released_at',
    ];

    protected $casts = [
        'breaking' => 'boolean',
        'is_current' => 'boolean',
        'released_at' => 'datetime',
        'size' => 'integer',
    ];
}
