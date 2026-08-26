<?php

return [
    'max_context_messages' => (int) env('APP_V1_MAX_CONTEXT_MESSAGES', 50),
    'features' => [
        'chat' => (bool) env('APP_V1_ENABLE_CHAT', false),
        'image' => (bool) env('APP_V1_ENABLE_IMAGE', false),
        'discovery' => (bool) env('APP_V1_ENABLE_DISCOVERY', false),
        'projects' => (bool) env('APP_V1_ENABLE_PROJECTS', false),
        'assets' => (bool) env('APP_V1_ENABLE_ASSETS', false),
        'billing' => (bool) env('APP_V1_ENABLE_BILLING', false),
        'agents' => (bool) env('APP_V1_ENABLE_AGENTS', false),
    ],
    'auth' => [
        'email_code' => (bool) env('APP_V1_ENABLE_EMAIL_CODE', false),
        'phone_sms' => (bool) env('APP_V1_ENABLE_PHONE_SMS', false),
        'wechat_mini' => (bool) env('APP_V1_ENABLE_WECHAT_MINI', false),
    ],
    'brand' => [
        'name' => env('APP_V1_BRAND_NAME', 'Zihui AI'),
        'description' => env('APP_V1_BRAND_DESCRIPTION', '智能创作平台'),
    ],
];
