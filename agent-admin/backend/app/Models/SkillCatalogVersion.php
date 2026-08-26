<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SkillCatalogVersion extends Model
{
    protected $table = 'skill_catalog_versions';

    protected $fillable = [
        'version_id', 'skill_id', 'version', 'status', 'sha256', 'package_path',
        'signature', 'key_id', 'manifest_json', 'permissions_json', 'published_at', 'revoked_at',
    ];

    protected $casts = [
        'manifest_json' => 'array',
        'permissions_json' => 'array',
        'published_at' => 'datetime',
        'revoked_at' => 'datetime',
    ];
}
