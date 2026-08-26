<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SkillRegistryReview extends Model
{
    protected $table = 'skill_registry_reviews';

    protected $fillable = ['version_id', 'action', 'reviewer_id', 'evidence'];
}
