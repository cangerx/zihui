<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class InspirationCategory extends Model
{
    protected $fillable = ['name', 'sort_order'];

    public function inspirations(): HasMany
    {
        return $this->hasMany(Inspiration::class, 'category_id');
    }
}
