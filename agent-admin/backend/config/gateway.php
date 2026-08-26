<?php

return [
    /*
    |--------------------------------------------------------------------------
    | 健康探测调度
    |--------------------------------------------------------------------------
    | probe_interval_minutes：ProbeProviders Command 跑频。建议 5 分钟一次。
    | probe_fail_suspend_threshold：连续 N 次基础探测失败 → provider 标记 suspended_at
    |   （不删除，可在控制台一键 recover）。配合 5 分钟间隔，6 次=半小时持续故障才熔断，
    |   避免网络抖动误伤。
    | metrics_retain_days：cloud_provider_metrics 保留天数；超出由探测任务批量清理。
    */
    'probe_interval_minutes' => (int) env('GATEWAY_PROBE_INTERVAL_MINUTES', 5),
    'probe_fail_suspend_threshold' => (int) env('GATEWAY_PROBE_FAIL_SUSPEND_THRESHOLD', 6),
    'metrics_retain_days' => (int) env('GATEWAY_METRICS_RETAIN_DAYS', 30),

    /*
    |--------------------------------------------------------------------------
    | 凭证池
    |--------------------------------------------------------------------------
    | credential_fail_invalid_threshold：单条 credential 连续失败 N 次 → status=invalid
    |   （不删除，可手动 reactivate）。GatewayRouter 选 key 时跳过 invalid 行。
    | credential_pool_strategy：凭证选择策略
    |   - "round_robin"（默认）：按 last_used_at + weight 轮询
    |   - "random_weighted" ：按 weight 加权随机
    */
    'credential_fail_invalid_threshold' => (int) env('GATEWAY_CREDENTIAL_FAIL_INVALID_THRESHOLD', 5),
    'credential_pool_strategy' => env('GATEWAY_CREDENTIAL_POOL_STRATEGY', 'round_robin'),

    /*
    |--------------------------------------------------------------------------
    | 默认能力清单（capabilities）
    |--------------------------------------------------------------------------
    | 老 provider 的 capabilities 字段 NULL 时，CapabilityFilter 用此默认值兜底。
    | 默认全部 true，等价当前 GatewayController 的硬编码行为，确保零行为变化。
    | 当前端 / 探测器主动写入更精细的 capabilities 后，按 provider 实际值生效。
    */
    'default_capabilities' => [
        'stream'           => true, // 是否支持 SSE 流式
        'usage_in_stream'  => true, // 流式响应里是否塞 stream_options.include_usage（拿 usage 用于计费）
        'tools'            => true, // 是否支持 tool calling / function calling
        'vision'           => true, // 是否支持 image_url content part
        'json_mode'        => true, // 是否支持 response_format=json_object / json_schema
        'reasoning_params' => false, // 推理模型语义：用 max_completion_tokens 替代 max_tokens、剥离 temperature 等
    ],

    /*
    |--------------------------------------------------------------------------
    | 默认超时（秒）
    |--------------------------------------------------------------------------
    | 与原 GatewayController 硬编码值一致，便于以后从代码里读 config 而不是再硬编。
    */
    'timeouts' => [
        'chat'       => (int) env('GATEWAY_TIMEOUT_CHAT', 180),
        'embeddings' => (int) env('GATEWAY_TIMEOUT_EMBEDDINGS', 60),
        // image 拉到 15min：覆盖 4K 长任务 + 多米异步轮询整个生命周期。
        // 配套不变量：retry_after(1020s) > Job::$timeout(960s) > image(900s)。
        'image'      => (int) env('GATEWAY_TIMEOUT_IMAGE', 900),
        'probe'      => (int) env('GATEWAY_TIMEOUT_PROBE', 10),
        'deep_probe' => (int) env('GATEWAY_TIMEOUT_DEEP_PROBE', 20),
    ],
];
