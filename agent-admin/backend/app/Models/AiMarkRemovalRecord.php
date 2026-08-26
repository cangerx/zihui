<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * 去AI标记用量/扣费记录。
 * 桌面端本地处理成功后回调扣费时写入；request_id 唯一，用于幂等。
 */
class AiMarkRemovalRecord extends Model
{
    protected $fillable = [
        'user_id', 'cost', 'balance_type', 'marks', 'image_count', 'status', 'request_id',
    ];

    protected $casts = [
        'cost' => 'decimal:4',
        'image_count' => 'integer',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
