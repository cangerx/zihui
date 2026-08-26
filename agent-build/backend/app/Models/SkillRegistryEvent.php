<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SkillRegistryEvent extends Model
{
    protected $table = 'skill_registry_events';

    public $timestamps = false;

    protected $fillable = ['event_type', 'skill_id', 'version_id', 'payload_json', 'created_at'];

    protected $casts = [
        'payload_json' => 'array',
        'created_at' => 'datetime',
    ];
}
