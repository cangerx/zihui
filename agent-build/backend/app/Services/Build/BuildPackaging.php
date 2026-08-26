<?php

namespace App\Services\Build;

/**
 * 客户端打包是否已从授权端下线（T5.3）。
 * 默认 retired：本版本不再对外接收/调度打包。紧急回切设 BUILD_PACKAGING_RETIRED=false。
 * 不删除实现类与数据表。
 */
class BuildPackaging
{
    public static function retired(): bool
    {
        try {
            if (function_exists('app') && app()->bound('config')) {
                return (bool) config('build.packaging_retired', true);
            }
        } catch (\Throwable $e) {
            // fall through
        }

        $raw = getenv('BUILD_PACKAGING_RETIRED');
        if ($raw === false || $raw === '') {
            return true;
        }

        return filter_var($raw, FILTER_VALIDATE_BOOLEAN);
    }

    /**
     * @return array<string, mixed>
     */
    public static function gonePayload(): array
    {
        return [
            'error' => 'packaging_retired',
            'error_code' => 'packaging_retired',
            'message' => '客户端打包已迁至云控端，本授权端不再接收打包任务。',
        ];
    }
}
