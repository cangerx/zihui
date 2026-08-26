<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SkillCatalogSyncState extends Model
{
    protected $table = 'skill_catalog_sync_state';

    protected $fillable = ['cursor', 'last_error', 'last_success_at'];

    protected $casts = ['last_success_at' => 'datetime'];
}
