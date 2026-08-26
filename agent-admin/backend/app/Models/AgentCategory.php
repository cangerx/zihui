<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AgentCategory extends Model
{
    protected $fillable = ['name', 'description', 'sort_order', 'is_visible'];

    protected $casts = [
        'is_visible' => 'boolean',
    ];

    public function agents(): HasMany
    {
        return $this->hasMany(Agent::class, 'category_id');
    }
}
