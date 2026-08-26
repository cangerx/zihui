<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * AI 抠图任务（独立于 ImageTask，因为阿里 viapi 协议跟 OpenAI image API 完全不同）。
 *
 * 状态机：
 *   pending → processing → completed
 *                      ↘ → failed
 *
 * result 字段（completed 时）：
 *   - image_url      string  阿里临时 URL（24h 有效，PNG 透明背景）
 *   - aliyun_request_id string 阿里端 trace ID
 *   - elapsed_ms     int     端到端耗时
 *
 * request_meta 字段（剥 base64 后入库）：
 *   - file_size      int     字节
 *   - file_extension string  png/jpg/jpeg/bmp
 *   - width / height int     原图分辨率（若可探测）
 *   - filename       string  原始文件名
 */
class MattingTask extends Model
{
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'id', 'user_id', 'source', 'request_meta',
        'status', 'result', 'error', 'cost', 'request_id',
    ];

    protected $casts = [
        'request_meta' => 'array',
        'result'       => 'array',
        'cost'         => 'float',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
