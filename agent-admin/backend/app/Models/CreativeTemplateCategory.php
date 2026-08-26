<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class CreativeTemplateCategory extends Model
{
    protected $fillable = ['name', 'description', 'sort_order', 'is_visible'];

    protected $casts = [
        'is_visible' => 'boolean',
    ];

    public function templates(): HasMany
    {
        return $this->hasMany(CreativeTemplate::class, 'category_id');
    }
}
