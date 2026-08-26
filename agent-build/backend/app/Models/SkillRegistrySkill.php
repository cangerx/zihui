<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class SkillRegistrySkill extends Model
{
    protected $table = 'skill_registry_skills';

    protected $fillable = ['skill_id', 'slug', 'name', 'status'];

    public function versions(): HasMany
    {
        return $this->hasMany(SkillRegistryVersion::class, 'skill_id', 'skill_id');
    }
}
