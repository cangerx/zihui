<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RedeemCode extends Model
{
    protected $fillable = [
        'code', 'type', 'reward_json', 'max_uses', 'used_count', 'per_user_limit',
        'starts_at', 'expires_at', 'status', 'batch_id', 'remark', 'created_by',
    ];

    protected $casts = [
        'reward_json'   => 'array',
        'starts_at'     => 'datetime',
        'expires_at'    => 'datetime',
        'max_uses'      => 'integer',
        'used_count'    => 'integer',
        'per_user_limit'=> 'integer',
    ];

    public function records()
    {
        return $this->hasMany(RedeemRecord::class, 'code_id');
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
