<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RedeemRecord extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'code_id', 'user_id', 'reward_snapshot_json', 'ip', 'user_agent', 'created_at',
    ];

    protected $casts = [
        'reward_snapshot_json' => 'array',
        'created_at' => 'datetime',
    ];

    public function code()
    {
        return $this->belongsTo(RedeemCode::class, 'code_id');
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
