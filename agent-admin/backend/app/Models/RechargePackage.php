<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RechargePackage extends Model
{
    protected $fillable = [
        'balance_type', 'pay_amount', 'base_amount', 'bonus_amount', 'title', 'status', 'sort',
    ];

    protected $casts = [
        'pay_amount' => 'decimal:2',
        'base_amount' => 'decimal:4',
        'bonus_amount' => 'decimal:4',
        'sort' => 'integer',
    ];
}
