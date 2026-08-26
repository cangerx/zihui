<?php

/*
|--------------------------------------------------------------------------
| 抠抠图（koukoutu.com）—— 精细抠图静态参数
|--------------------------------------------------------------------------
| 业务参数（API Key / 三档单价 / 三档尺寸阈值 / 启用开关）全部移到 SystemSetting
| 表 (fine_matting_*)，由管理后台「精细抠图 → 自定义设置」配置；本配置文件仅保留
| 运行期不可变 / 不需要管理员调整的端点、轮询、并发与文件限制参数。
|
| 接口（异步 API，Image File 模式）：
|   - 创建：POST {base_url}/v1/create   multipart/form-data，返回 data.task_id
|   - 轮询：POST {base_url}/v1/query    x-www-form-urlencoded，data.result_file 有值即成功
|
| 并发：抠抠图对单账号「并发任务数 5」，故全站并发信号量默认 5。
| 安全：API Key 仅在 SystemSetting (encrypted) + 服务端使用，绝不下发到桌面端。
*/

return [
    'fine_matting' => [
        'base_url'       => env('KOUKOUTU_BASE_URL', 'https://async.koukoutu.com'),
        'model_key'      => env('KOUKOUTU_MODEL_KEY', 'background-removal'),
        // 输出固定 png（透明底）；抠抠图默认 webp，必须显式指定 png
        'output_format'  => 'png',

        // 异步轮询：建议 1s/次，单任务最长等待
        'poll_interval_seconds' => (int) env('KOUKOUTU_POLL_INTERVAL', 1),
        'poll_timeout_seconds'  => (int) env('KOUKOUTU_POLL_TIMEOUT', 120),
        // 单次 HTTP 请求超时（create / query 各自）
        'http_timeout_seconds'  => (int) env('KOUKOUTU_HTTP_TIMEOUT', 30),

        // 并发控制：全站同时在处理的任务数（对齐抠抠图 5）+ 单用户并发
        'global_concurrency'    => (int) env('KOUKOUTU_GLOBAL_CONCURRENCY', 5),
        'per_user_concurrency'  => (int) env('KOUKOUTU_PER_USER_CONCURRENCY', 3),

        // 文件限制（来自抠抠图官方文档）
        'max_file_size_bytes' => 40 * 1024 * 1024,
        'max_resolution'      => 10000,
        'allowed_extensions'  => ['png', 'jpg', 'jpeg', 'webp'],

        // 三档尺寸阈值（长边像素）兜底值；以 SystemSetting fine_matting_tier_threshold_1/2 为准
        'tier_threshold_1' => 4096, // 档1上界：长边 < 4096 → 4K 以下
        'tier_threshold_2' => 7680, // 档2上界：4096 ≤ 长边 < 7680 → 4K–8K；≥ 7680 → 8K 以上
    ],
];
