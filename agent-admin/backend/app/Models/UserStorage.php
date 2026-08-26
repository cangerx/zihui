<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UserStorage extends Model
{
    protected $table = 'user_storage';
    protected $primaryKey = 'user_id';
    public $incrementing = false;
    protected $keyType = 'int';
    public $timestamps = false;

    protected $fillable = ['user_id', 'used_bytes', 'updated_at'];

    protected $casts = [
        'used_bytes' => 'integer',
        'updated_at' => 'datetime',
    ];
}
