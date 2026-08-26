<?php

return [
    /*
    | 执行后端选择（T4.4）。
    | local：走云控本地执行账本；remote：走 AgentBuildClient 授权端；
    | auto：APP_ENV=local/testing 用 local，其它环境用 remote（避免生产无 GitHub/client 时把打包页打挂）。
    | 显式 CLOUDBUILD_BACKEND=local|remote 可覆盖 auto，同时锁死 cutover 命令的 backend override。
    | T5.2 在 auto 下把 override 写入 storage/app/cloud-build-cutover.json（无秘密）。
    */
    'backend' => env('CLOUDBUILD_BACKEND') ?: 'auto',

    /*
    | Agent-Build remote (the cloud-build backend authorizing this agent-admin's
    | domain). agent-build 0.2.0+ uses domain-only auth, so this side does not
    | need a client_id / client_secret anymore. The runtime Origin header (this
    | site's host) must match a row in agent-build's authorized_clients.domain.
    */
    'agent_build' => [
        // 一律用 ?: 兑空值：env() 第二参数只在变量「未定义」时生效；客户 .env
        // 里写 `AGENT_BUILD_BASE_URL=`（有等号、值为空）会让 env() 返回空字符串
        // 而不是兑底。1.2.2 改用 ?: 兜底，老站点升级即修复，无需改 .env。
        'base_url' => env('AGENT_BUILD_BASE_URL') ?: 'https://your-build-domain.example.com',
        // override only if reverse-proxy strips Host; otherwise auto-detected per request
        'origin' => env('AGENT_BUILD_ORIGIN') ?: (env('APP_URL') ?: 'https://your-admin-domain.example.com'),
        'timeout_seconds' => (int) (env('AGENT_BUILD_TIMEOUT') ?: 15),
        'verify_ssl' => env('AGENT_BUILD_VERIFY_SSL', false),
    ],

    /*
    | Download
    */
    'download' => [
        // 默认 1800 秒（30 分钟）：跨服务器 / 跨区域传 90+ MB 时 600s 不够
        // 客户网络更慢可在 .env 加 CLOUDBUILD_DOWNLOAD_TIMEOUT=3600 等更长值
        'timeout_seconds' => (int) env('CLOUDBUILD_DOWNLOAD_TIMEOUT', 1800),
        // 「直连优先」尝试（家庭电脑 preferred_url）的快速失败阈值（秒）：连不上或中途持续
        // 低速即放弃，立刻回退 CDN，避免家里被 CGNAT 挡住/离线时白等。仅作用于非最后一个候选。
        'direct_connect_timeout' => (int) (env('CLOUDBUILD_DIRECT_CONNECT_TIMEOUT') ?: 8),
        'sign_secret' => env('BUILD_SIGN_SECRET', ''),
        'ttl_seconds' => (int) (env('BUILD_DOWNLOAD_TTL') ?: 1800),
        'base_url' => env('BUILD_DOWNLOAD_BASE') ?: '',
    ],

    /*
    | Where atomic-replace puts artifacts. Default: public/updates/.
    | Override only if you serve updates from a non-default location.
    */
    'updates_dir' => env('CLOUDBUILD_UPDATES_DIR'),

    /*
    | 本地执行（T4.2）。GitHub 凭据只从环境注入，禁止写入仓库。
    | token/repo 为空时 cloud-build:dispatch-pending 直接跳过，现有 AgentBuildClient 不受影响。
    */
    'github' => [
        'token' => env('GITHUB_BUILD_TOKEN', ''),
        'repo' => env('GITHUB_BUILD_REPO', ''),
        'ref' => env('GITHUB_BUILD_REF') ?: 'main',
        'workflow_win' => env('GITHUB_WORKFLOW_WIN') ?: 'build-win.yml',
        'workflow_mac' => env('GITHUB_WORKFLOW_MAC') ?: 'build-mac.yml',
        'verify_ssl' => filter_var(env('GITHUB_BUILD_VERIFY_SSL', 'true'), FILTER_VALIDATE_BOOLEAN),
        'download_timeout' => (int) (env('GITHUB_BUILD_DOWNLOAD_TIMEOUT') ?: 1800),
        'api_timeout' => (int) (env('GITHUB_BUILD_API_TIMEOUT') ?: 30),
        'callback_url' => env('CLOUDBUILD_GITHUB_CALLBACK_URL') ?: '',
    ],

    'execution' => [
        'max_dispatch_attempts' => (int) (env('CLOUDBUILD_DISPATCH_MAX_ATTEMPTS') ?: 3),
        'dispatch_batch_size' => (int) (env('CLOUDBUILD_DISPATCH_BATCH_SIZE') ?: 5),
        'ack_timeout_hours' => (int) (env('CLOUDBUILD_ACK_TIMEOUT_HOURS') ?: 24),
        'stuck_minutes' => (int) (env('CLOUDBUILD_STUCK_MINUTES') ?: 20),
        // 已拿到 GitHub run_id 且仍在跑：Windows 首次 electron 打包常超过 20 分钟。
        'stuck_run_minutes' => (int) (env('CLOUDBUILD_STUCK_RUN_MINUTES') ?: 90),
        // 开始观察 building 任务（回写 run_id / 对账已结束的 run）的最短等待。
        'stuck_observe_minutes' => (int) (env('CLOUDBUILD_STUCK_OBSERVE_MINUTES') ?: 2),
        'stale_claim_minutes' => (int) (env('CLOUDBUILD_STALE_CLAIM_MINUTES') ?: 10),
        'queue_paused' => filter_var(env('CLOUDBUILD_QUEUE_PAUSED', false), FILTER_VALIDATE_BOOLEAN),
        'queue' => [
            'max_depth' => (int) (env('BUILD_QUEUE_MAX_DEPTH') ?: 100),
            'warning_depth' => (int) (env('BUILD_QUEUE_WARNING_DEPTH') ?: 30),
            'critical_depth' => (int) (env('BUILD_QUEUE_CRITICAL_DEPTH') ?: 60),
        ],
        'fetch_max_attempts' => (int) (env('CLOUDBUILD_FETCH_MAX_ATTEMPTS') ?: 3),
        'mirror_assignment_minutes' => (int) (env('CLOUDBUILD_MIRROR_ASSIGNMENT_MINUTES') ?: 90),
        'orphan_retention_days' => (int) (env('CLOUDBUILD_ORPHAN_RETENTION_DAYS') ?: 2),
        'local_daily_limit' => (int) (env('CLOUDBUILD_LOCAL_DAILY_LIMIT') ?: 20),
    ],

    'storage' => [
        'root' => env('CLOUDBUILD_ARTIFACT_ROOT', ''),
        'subdir' => env('BUILD_STORAGE_SUBDIR', ''),
    ],

    'mirror' => [
        'worker_token' => env('CLOUDBUILD_MIRROR_WORKER_TOKEN', ''),
    ],
];
