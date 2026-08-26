<?php

return [

    /*
    | T5.3：客户端打包是否已从本授权端下线。
    | 默认 true：对外 /api/build 与打包 cron 停用。紧急回切设 BUILD_PACKAGING_RETIRED=false。
    | 不删除实现类与数据表。
    */
    'packaging_retired' => filter_var(env('BUILD_PACKAGING_RETIRED', true), FILTER_VALIDATE_BOOLEAN),

    /*
    |--------------------------------------------------------------------------
    | GitHub Actions 调度配置
    |--------------------------------------------------------------------------
    */
    'github' => [
        // fine-grained PAT，权限：Actions: write (对 workflow_dispatch 和 artifacts 删除都够)
        'token' => env('GITHUB_BUILD_TOKEN', ''),
        'verify_ssl' => filter_var(env('GITHUB_BUILD_VERIFY_SSL', 'true'), FILTER_VALIDATE_BOOLEAN),
        'repo' => env('GITHUB_BUILD_REPO', 'your-org/your-build-repo'),
        'workflow_win' => env('GITHUB_WORKFLOW_WIN', 'build-win.yml'),
        'workflow_mac' => env('GITHUB_WORKFLOW_MAC', 'build-mac.yml'),
        'ref' => env('GITHUB_BUILD_REF', 'main'),
        // 0.3.2: artifact 下载超时（秒）。默认 1800 秒（30 分钟），跨区慢网安全裕度足够。
        // 用 ?: 兑底空值（防 .env 里写 GITHUB_BUILD_DOWNLOAD_TIMEOUT= 空字符串覆盖默认）。
        'download_timeout' => (int) (env('GITHUB_BUILD_DOWNLOAD_TIMEOUT') ?: 1800),
    ],

    /*
    |--------------------------------------------------------------------------
    | 签名下载 URL（/dl/{token}）配置
    |--------------------------------------------------------------------------
    */
    'download' => [
        // HMAC-SHA256 签名密钥，与 client_secret 隔离
        'sign_secret' => env('BUILD_SIGN_SECRET', 'dev-only-change-in-prod'),
        'base_url' => env('BUILD_DOWNLOAD_BASE', 'https://your-build-domain.example.com/dl'),
        'ttl_seconds' => (int) env('BUILD_DOWNLOAD_TTL', 1800), // 30 min
    ],

    /*
    |--------------------------------------------------------------------------
    | artifact 本地中转存储（相对 storage_path()）
    |--------------------------------------------------------------------------
    */
    'storage' => [
        'subdir' => env('BUILD_STORAGE_SUBDIR', 'app/build-artifacts'),
    ],

    /*
    |--------------------------------------------------------------------------
    | 队列 / 配额阈值
    |--------------------------------------------------------------------------
    */
    'queue' => [
        'max_depth' => (int) env('BUILD_QUEUE_MAX_DEPTH', 100),
        'warning_depth' => (int) env('BUILD_QUEUE_WARNING_DEPTH', 30),
        'critical_depth' => (int) env('BUILD_QUEUE_CRITICAL_DEPTH', 60),
    ],

    /*
    |--------------------------------------------------------------------------
    | 家庭电脑直连下载（绕过 CDN 提速）
    |--------------------------------------------------------------------------
    |
    | 背景：mirror 产物默认经 your-cdn-domain.example.com（腾讯云免费 CDN）分发，回源到家庭/办公室
    | 上行较慢。开启本特性后，download() 出库时额外给云控端一个 `preferred_url`——
    | 指向家庭电脑公网IP的直连地址（http://{ip}:{port}/...）。云控端「直连优先、CDN 兜底」：
    | 先试 preferred_url，连不上/超时立即回退 CDN 的 url，因此即使家里被 CGNAT 挡住也不会更糟。
    |
    | 公网IP 来源：mirror worker（家庭电脑）每次 poll 时用 X-Worker-Public-Ip 头自报，
    | 存 system_settings(group=mirror, key=worker_ip / worker_ip_at)。IP 是动态的，
    | 「绝不」入库到 build_requests.mirror_url_primary（否则 IP 一变历史 build 全死链）——
    | 只在 download() 出库那一刻用「最新IP + 相对路径」动态拼，所以 IP 怎么变都不影响存量。
    |
    | path_template 必须与 worker 的 SFTP_REMOTE_BASE + nginx alias 对齐（与
    | MIRROR_URL_TEMPLATE 的路径段一致）。{BUILD_ID}/{FILENAME} 运行时替换。
    */
    'direct_mirror' => [
        'enabled' => filter_var(env('DIRECT_MIRROR_ENABLED', false), FILTER_VALIDATE_BOOLEAN),
        'scheme' => env('DIRECT_MIRROR_SCHEME') ?: 'http',
        'port' => (int) (env('DIRECT_MIRROR_PORT') ?: 893),
        'path_template' => env('DIRECT_MIRROR_PATH_TEMPLATE') ?: '/build-mirror/{BUILD_ID}/{FILENAME}',
        // worker IP 心跳超过此秒数视为家庭电脑失联，不再下发 preferred_url（只走 CDN），
        // 避免给一个必死的直连地址。默认 600s（worker 30s poll 一次，10 分钟没动静即判失联）。
        'ip_max_age_seconds' => (int) (env('DIRECT_MIRROR_IP_MAX_AGE') ?: 600),
    ],

];
