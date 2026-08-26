<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Default Queue Connection Name
    |--------------------------------------------------------------------------
    |
    | 默认 sync：dispatch 时立即在当前进程同步执行，但 GatewayController 会用
    | `app()->terminating` 包装让其在 HTTP 响应后跑，等同于老的 `Artisan::call`
    | 伪异步行为 —— 老部署升级零配置、不需要 worker。
    |
    | 想要"真异步 + 失败重试 + failed_jobs 可观测"的部署，把 .env 的
    | QUEUE_CONNECTION 显式改为 database，并起守护：
    |
    |     php artisan queue:work database --queue=image,default --tries=2 --timeout=960 --sleep=2
    |
    | GatewayController 会自动按当前 driver 选择路径。
    |
    */

    'default' => env('QUEUE_CONNECTION', 'sync'),

    /*
    |--------------------------------------------------------------------------
    | Queue Connections
    |--------------------------------------------------------------------------
    */

    'connections' => [

        'sync' => [
            'driver' => 'sync',
        ],

        'database' => [
            'driver' => 'database',
            'table' => 'jobs',
            'queue' => 'default',
            // 任务取走后 N 秒内未释放 → 视为崩溃，可被另一个 worker 重新取走。
            // **必须 > Job::$timeout**，否则正常长任务（如多米 4K 异步轮询接近 15min）会被
            // 误判崩溃 → 另一个 worker 再次执行同一任务 → 重复打上游 + 重复扣费。
            // 当前不变量：retry_after(1020s) > Job::$timeout(960s) > image timeout(900s)。
            'retry_after' => 1020,
            'after_commit' => false,
        ],

        'redis' => [
            'driver' => 'redis',
            'connection' => 'default',
            'queue' => env('REDIS_QUEUE', 'default'),
            // 同 database driver：retry_after 必须 > Job::$timeout，否则重复执行。
            'retry_after' => 1020,
            'block_for' => null,
            'after_commit' => false,
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Failed Queue Jobs
    |--------------------------------------------------------------------------
    |
    | 任务超过 tries 上限 / 抛未捕获异常时落入 failed_jobs 表，
    | 可用 `php artisan queue:failed` / `queue:retry {id}` / `queue:flush` 排障。
    |
    */

    'failed' => [
        'driver' => env('QUEUE_FAILED_DRIVER', 'database-uuids'),
        'database' => env('DB_CONNECTION', 'mysql'),
        'table' => 'failed_jobs',
    ],

];
