<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class SharedAgentCategory extends Model
{
    protected $table = 'shared_agent_categories';

    protected $fillable = [
        'name',
        'slug',
        'sort_order',
    ];

    protected $casts = [
        'sort_order' => 'integer',
    ];

    public function agents(): HasMany
    {
        return $this->hasMany(SharedAgent::class, 'category_id');
    }
}
