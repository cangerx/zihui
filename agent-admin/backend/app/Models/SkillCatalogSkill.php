<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class SkillCatalogSkill extends Model
{
    protected $table = 'skill_catalog_skills';

    protected $fillable = ['skill_id', 'slug', 'name', 'status', 'category', 'recommended'];

    public function versions(): HasMany
    {
        return $this->hasMany(SkillCatalogVersion::class, 'skill_id', 'skill_id');
    }
}
