<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Announcement extends Model
{
    protected $fillable = [
        'title', 'content', 'enabled', 'sort_order',
    ];

    protected $casts = [
        'enabled' => 'boolean',
        'sort_order' => 'integer',
    ];

    /**
     * 客户端 current 接口热点查询：取当前启用的、排序最高的一条公告。
     * 索引 idx_announcements_active = (enabled, sort_order, id) 命中 ORDER BY 时使用 desc。
     */
    public static function currentActive(): ?self
    {
        return static::query()
            ->where('enabled', true)
            ->orderByDesc('sort_order')
            ->orderByDesc('id')
            ->first();
    }
}
