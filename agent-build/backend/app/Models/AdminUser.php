<?php

namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class AdminUser extends Authenticatable
{
    use HasApiTokens, Notifiable;

    protected $table = 'admin_users';

    protected $fillable = [
        'username',
        'password_hash',
        'name',
        'role',
        'is_active',
        'last_login_at',
    ];

    protected $hidden = [
        'password_hash',
        'remember_token',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'last_login_at' => 'datetime',
    ];

    public $timestamps = true;

    /**
     * Sanctum 兼容：用 password_hash 字段而非默认 password
     */
    public function getAuthPassword()
    {
        return $this->password_hash;
    }
}
