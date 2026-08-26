<?php

/**
 * 官方模型参考价目录。供云控开通对照，不写入售价，不向客户端下发。
 * amount_cny 仅在有可核对官方价目时填写；否则只保留 text 与 source_url。
 */
return [
    'items' => [
        [
            'id' => 'doubao-seedance-2-0-260128',
            'aliases' => ['seedance-2.0', 'seedance 2.0'],
            'modality' => 'video',
            'unit' => 'per_million_tokens',
            'amount_cny' => 46,
            'text' => '不含视频输入约 46 元/百万 Token；含视频输入约 28 元/百万 Token。5 秒 720P 约 4.97 元（方舟价目摘录）。',
            'source_url' => 'https://www.volcengine.com/docs/82379/1544106',
            'captured_at' => '2026-08-23',
        ],
        [
            'id' => 'doubao-seedance-2-0-fast-260128',
            'aliases' => ['seedance-2.0-fast', 'seedance 2.0 fast'],
            'modality' => 'video',
            'unit' => 'per_million_tokens',
            'amount_cny' => null,
            'text' => 'Seedance 2.0 Fast，按火山方舟 Token 计费，以控制台价目为准。',
            'source_url' => 'https://www.volcengine.com/docs/82379/1544106',
            'captured_at' => '2026-08-23',
        ],
        [
            'id' => 'doubao-seedance-2-5',
            'aliases' => ['seedance-2.5', 'seedance 2.5', 'doubao-seedance-2-5-260628'],
            'modality' => 'video',
            'unit' => 'per_million_tokens',
            'amount_cny' => 70,
            'text' => '不含视频输入 70 元/百万 Token；含视频输入 42 元/百万 Token。5 秒 720P 约 7.56 元（方舟价目摘录）。',
            'source_url' => 'https://www.volcengine.com/docs/82379/1544106',
            'captured_at' => '2026-08-23',
        ],
        [
            'id' => 'MiniMax-H3',
            'aliases' => ['minimax-h3', 'minimax h3'],
            'modality' => 'video',
            'unit' => 'per_sku',
            'amount_cny' => null,
            'text' => '按 MiniMax Token / 企业套餐计费，以开放平台价目为准。',
            'source_url' => 'https://platform.minimaxi.com/subscribe/token-plan?tab=api-enterprise',
            'captured_at' => '2026-08-23',
        ],
        [
            'id' => 'kling-v3',
            'aliases' => ['kling v3', 'kling-v3-0'],
            'modality' => 'video',
            'unit' => 'per_second',
            'amount_cny' => null,
            'text' => '可灵官方按秒与 std/pro 档计费，以可灵开放平台价目为准。',
            'source_url' => 'https://app.klingai.com/cn/dev/document-api/productBilling/prePaidResourcePackage',
            'captured_at' => '2026-08-23',
        ],
    ],
];
