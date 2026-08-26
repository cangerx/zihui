<?php

namespace App\Services\CloudBuild;

/**
 * 云控打包页面对执行后端的稳定接口。
 * 本地与远程适配器必须保持同一响应形状，前端不感知切换。
 */
interface CloudBuildBackend
{
    public function driver(): string;

    public function isConfigured(): bool;

    public function currentOrigin(): string;

    public function checkAuth(): array;

    public function requestBuild(string $appName, string $platform, ?string $iconUrl = null): array;

    public function requestOemBuild(
        string $appName,
        string $platform,
        string $iconUrl,
        string $projectKey,
        string $appId,
        string $updatePath,
        ?string $appVersion = null,
        array $buildOptions = []
    ): array;

    public function getStatus(string $buildId): array;

    public function cancel(string $buildId, bool $force = false): array;

    public function templateInfo(): array;

    public function getMyInfo(): array;

    public function updateMyInfo(string $ownerName, ?string $ownerPhone): array;
}
