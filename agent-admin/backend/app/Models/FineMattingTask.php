<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * 精细抠图任务（抠抠图 koukoutu 异步 API，独立于 MattingTask）。
 *
 * 状态机：
 *   pending → processing → completed
 *                      ↘ → failed
 *
 * result 字段（completed 时）：
 *   - image_url         string  抠抠图结果 URL（response=url，PNG 透明背景）
 *   - request_id        string  我们端 trace ID
 *   - provider_task_id  string  抠抠图端 task_id
 *   - elapsed_ms        int     端到端耗时
 *
 * request_meta 字段：
 *   - file_size      int     字节
 *   - file_extension string  png/jpg/jpeg/webp
 *   - width / height int     原图分辨率
 *   - filename       string  原始文件名
 *
 * 计费：width/height 决定 tier(1/2/3)，cost 为本系统积分扣费（按长边三档，后台可配）。
 */
class FineMattingTask extends Model
{
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'id', 'user_id', 'source', 'request_meta',
        'status', 'result', 'error', 'cost', 'request_id',
        'width', 'height', 'tier', 'provider_task_id',
    ];

    protected $casts = [
        'request_meta' => 'array',
        'result'       => 'array',
        'cost'         => 'float',
        'width'        => 'int',
        'height'       => 'int',
        'tier'         => 'int',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
