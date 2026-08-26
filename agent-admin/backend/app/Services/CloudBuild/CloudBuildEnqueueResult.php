<?php

namespace App\Services\CloudBuild;

use App\Models\CloudBuildJob;

/**
 * 本地执行入队结果。httpStatus 供 T4.4 控制器映射；T4.2 测试直接读 error/job。
 */
class CloudBuildEnqueueResult
{
    public function __construct(
        public bool $ok,
        public string $error,
        public int $httpStatus,
        public ?CloudBuildJob $job = null,
        public array $extra = [],
    ) {
    }

    public static function ok(CloudBuildJob $job): self
    {
        return new self(true, '', 200, $job);
    }

    public static function fail(string $error, int $httpStatus, array $extra = []): self
    {
        return new self(false, $error, $httpStatus, null, $extra);
    }
}
