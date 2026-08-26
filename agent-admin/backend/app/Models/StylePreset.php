<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class StylePreset extends Model
{
    protected $fillable = [
        'name',
        'prompt_fragment',
        'sample_image',
        'category',
        'sort_order',
        'is_enabled',
    ];

    protected $casts = [
        'sort_order' => 'integer',
        'is_enabled' => 'boolean',
    ];
}
