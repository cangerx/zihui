<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class DocCategory extends Model
{
    protected $fillable = ['name', 'slug', 'sort_order', 'is_visible'];

    protected $casts = [
        'sort_order' => 'integer',
        'is_visible' => 'boolean',
    ];

    public function docs(): HasMany
    {
        return $this->hasMany(Doc::class, 'category_id');
    }
}
