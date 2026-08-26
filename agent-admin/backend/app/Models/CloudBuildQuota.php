<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CloudBuildQuota extends Model
{
    protected $table = 'cloud_build_quotas';

    protected $fillable = [
        'client_ref',
        'quota_date',
        'consumed',
    ];

    protected $casts = [
        'quota_date' => 'date',
        'consumed' => 'integer',
    ];
}
