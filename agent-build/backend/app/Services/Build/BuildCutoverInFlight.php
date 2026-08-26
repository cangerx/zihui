<?php

namespace App\Services\Build;

/**
 * 授权端在途任务判定。与 LAP-035 排空范围一致：
 * pending/queued/building，以及 success + mirror pending/mirroring。
 * 禁止用此结果改绑 callback。
 */
class BuildCutoverInFlight
{
    public static function isInFlight(?string $status, ?string $mirrorStatus): bool
    {
        if (in_array($status, ['pending', 'queued', 'building'], true)) {
            return true;
        }
        return $status === 'success' && in_array($mirrorStatus, ['pending', 'mirroring'], true);
    }
}
