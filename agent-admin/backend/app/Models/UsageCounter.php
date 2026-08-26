<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UsageCounter extends Model
{
    protected $fillable = [
        'user_id', 'counter_key', 'period', 'used',
    ];

    protected $casts = [
        'used' => 'integer',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
