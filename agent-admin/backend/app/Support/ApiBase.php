<?php

namespace App\Support;

/**
 * OpenAI 兼容服务商 API 地址规范化。
 *
 * 规则：
 *   1. 去前后空格 + 去尾部多余 /
 *   2. 若 URL 已含 /v1 /v2 /v4 /v1beta 等任意版本号段 → 保持原样
 *   3. 否则自动追加 /v1（95% 的 OpenAI 兼容服务都需要 /v1）
 *
 * 保持与桌面端 src/main/services/api-base-normalize.ts 一致。
 * 任何一端修改规则，另一端必须同步。
 */
class ApiBase
{
    public static function normalize(?string $url): string
    {
        $trimmed = preg_replace('#/+$#', '', trim((string) $url));
        if ($trimmed === '' || $trimmed === null) {
            return '';
        }
        // 已含任意版本号段（/v1 /v2 /v4 /v1beta 等）→ 原样返回
        if (preg_match('#/v\d+[a-z]*(/|$)#i', $trimmed)) {
            return $trimmed;
        }
        return $trimmed . '/v1';
    }
}
