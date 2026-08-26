<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class SkillRegistryVersion extends Model
{
    protected $table = 'skill_registry_versions';

    protected $fillable = [
        'version_id', 'skill_id', 'version', 'status', 'sha256', 'package_path',
        'package_size', 'file_count', 'manifest_json', 'permissions_json', 'scan_report',
        'signature', 'signature_algorithm', 'key_id', 'published_at', 'revoked_at',
        'reject_reason', 'uploaded_by',
    ];

    protected $casts = [
        'manifest_json' => 'array',
        'permissions_json' => 'array',
        'scan_report' => 'array',
        'published_at' => 'datetime',
        'revoked_at' => 'datetime',
    ];

    protected $hidden = [];

    public function skill(): BelongsTo
    {
        return $this->belongsTo(SkillRegistrySkill::class, 'skill_id', 'skill_id');
    }

    public function reviews(): HasMany
    {
        return $this->hasMany(SkillRegistryReview::class, 'version_id', 'version_id');
    }
}
