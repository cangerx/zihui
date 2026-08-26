<?php

namespace App\Services\Video;

class VideoProtocols
{
    /** 算力超市 / DashScope 兼容的 Wan 视频任务协议（POST /api/v1/tasks）。 */
    public static function isWan(string $protocol): bool
    {
        $p = strtolower(trim($protocol));
        return in_array($p, ['wan', 'wan3', 'wan3.0', 'wan3.0-video', 'dashscope', 'dashscope_compatible'], true);
    }
}
