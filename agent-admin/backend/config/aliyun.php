<?php

/*
|--------------------------------------------------------------------------
| 阿里云视觉智能开放平台（viapi）—— 抠图静态参数
|--------------------------------------------------------------------------
| v1.5.0+ 调整：AccessKey / endpoint / region_id / 单次扣费等业务参数全部移到 SystemSetting
| 表 (matting_*)，由管理后台「AI 抠图 → 自定义设置」配置；本配置文件仅保留运行期不可变 / 不需要
| 管理员调整的限流与文件限制参数。
|
| - matting.poll_interval_seconds：异步轮询间隔（默认 2s，太短会触发阿里限流）
| - matting.poll_timeout_seconds：单任务最长等待（默认 60s，覆盖 99% 图）
| - matting.global_qps：全站对阿里 QPS 上限（5），Redis token bucket 用
| - matting.per_user_concurrency：单用户并发上限（3），Redis sliding window 用
|
| 安全：AK 仅在 SystemSetting (encrypted) + 服务端使用，绝不下发到桌面端
*/

return [
    'matting' => [
        // 异步轮询：从提交到完成
        'poll_interval_seconds' => (int) env('ALIYUN_MATTING_POLL_INTERVAL', 2),
        'poll_timeout_seconds'  => (int) env('ALIYUN_MATTING_POLL_TIMEOUT', 60),

        // 限流（云控端中转模式）：全站 QPS + 单用户并发
        'global_qps'              => (int) env('ALIYUN_MATTING_GLOBAL_QPS', 5),
        'per_user_concurrency'    => (int) env('ALIYUN_MATTING_PER_USER_CONCURRENCY', 3),
        'rate_limit_window_secs'  => (int) env('ALIYUN_MATTING_RATE_LIMIT_WINDOW', 60),

        // 文件限制（来自阿里官方文档）
        'max_file_size_bytes'  => 40 * 1024 * 1024,
        'max_resolution'       => 10000,
        'min_resolution'       => 32,
        'allowed_extensions'   => ['png', 'jpg', 'jpeg', 'bmp'],
    ],
];
