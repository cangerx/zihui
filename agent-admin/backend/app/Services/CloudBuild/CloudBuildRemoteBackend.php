<?php

namespace App\Services\CloudBuild;

/**
 * 远程授权端适配器。T4.4 之后 AgentBuildClient 只允许出现在这里。
 */
class CloudBuildRemoteBackend implements CloudBuildBackend
{
    public function __construct(private AgentBuildClient $sdk)
    {
    }

    public function driver(): string
    {
        return 'remote';
    }

    public function isConfigured(): bool
    {
        return $this->sdk->isConfigured();
    }

    public function currentOrigin(): string
    {
        return $this->sdk->currentOrigin();
    }

    public function checkAuth(): array
    {
        return $this->sdk->checkAuth();
    }

    public function requestBuild(string $appName, string $platform, ?string $iconUrl = null): array
    {
        return $this->sdk->requestBuild($appName, $platform, $iconUrl);
    }

    public function requestOemBuild(
        string $appName,
        string $platform,
        string $iconUrl,
        string $projectKey,
        string $appId,
        string $updatePath,
        ?string $appVersion = null,
        array $buildOptions = []
    ): array {
        return $this->sdk->requestOemBuild(
            $appName,
            $platform,
            $iconUrl,
            $projectKey,
            $appId,
            $updatePath,
            $appVersion,
            $buildOptions
        );
    }

    public function getStatus(string $buildId): array
    {
        return $this->sdk->getStatus($buildId);
    }

    public function cancel(string $buildId, bool $force = false): array
    {
        if ($force) {
            return ['_status' => 200, 'forced' => true];
        }

        return $this->sdk->cancel($buildId);
    }

    public function templateInfo(): array
    {
        return $this->sdk->templateInfo();
    }

    public function getMyInfo(): array
    {
        return $this->sdk->getMyInfo();
    }

    public function updateMyInfo(string $ownerName, ?string $ownerPhone): array
    {
        return $this->sdk->updateMyInfo($ownerName, $ownerPhone);
    }
}
