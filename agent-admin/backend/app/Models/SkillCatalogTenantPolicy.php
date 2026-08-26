<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SkillCatalogTenantPolicy extends Model
{
    protected $table = 'skill_catalog_tenant_policies';

    protected $fillable = ['tenant_id', 'skill_id', 'listed'];

    protected $casts = ['listed' => 'boolean'];
}
