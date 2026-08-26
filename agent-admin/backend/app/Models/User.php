<?php

namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Tymon\JWTAuth\Contracts\JWTSubject;

class User extends Authenticatable implements JWTSubject
{
    use Notifiable;

    protected $fillable = [
        'username', 'email', 'password', 'phone', 'nickname', 'role', 'status', 'remark',
        'register_ip', 'register_device_id', 'register_oem_project_key', 'inspiration_uploader',
        'last_login_at',
    ];

    protected $hidden = [
        'password',
    ];

    protected $casts = [
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
        'inspiration_uploader' => 'boolean',
        'last_login_at' => 'datetime',
    ];

    public function getJWTIdentifier()
    {
        return $this->getKey();
    }

    public function getJWTCustomClaims()
    {
        return ['role' => $this->role];
    }

    public function groups()
    {
        return $this->belongsToMany(UserGroup::class, 'user_group_members', 'user_id', 'group_id');
    }

    public function balances()
    {
        return $this->hasMany(UserBalance::class);
    }

    public function usageRecords()
    {
        return $this->hasMany(UsageRecord::class);
    }

    public function planQuotas()
    {
        return $this->hasMany(UserPlanQuota::class);
    }

    public function oemProjectMembers()
    {
        return $this->hasMany(OemProjectMember::class, 'user_id');
    }

    public function getBalance(string $type): float
    {
        $wallet = $this->balances()->where('balance_type', $type)->first();
        $walletAmount = $wallet ? (float)$wallet->amount : 0;
        $planAmount = $this->planQuotas()
            ->where('balance_type', $type)
            ->where('status', 'active')
            ->where(function ($q) {
                $q->whereNull('expires_at')->orWhere('expires_at', '>', now());
            })
            ->get()
            ->sum(fn($q) => max(0, (float)$q->granted - (float)$q->consumed));

        return $walletAmount + (float)$planAmount;
    }
}
