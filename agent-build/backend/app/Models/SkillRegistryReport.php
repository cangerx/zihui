<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SkillRegistryReport extends Model
{
    protected $table = 'skill_registry_reports';

    protected $fillable = ['skill_id', 'version_id', 'reason', 'reporter'];
}
