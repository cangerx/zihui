<?php

namespace App\Services\CloudBuild;

/**
 * 解析 cloudbuild.backend。
 * auto：APP_ENV 为 local/testing 用本地执行，其它环境用远程授权端。
 */
class CloudBuildBackendSelector
{
    public function __construct(
        private ?string $configured = null,
        private ?string $appEnv = null,
        private ?CloudBuildCutoverStore $cutover = null,
    ) {
    }

    public static function fromConfig(?CloudBuildCutoverStore $cutover = null): self
    {
        $configured = 'auto';
        $env = (string) (getenv('APP_ENV') ?: 'production');
        try {
            if (function_exists('app') && app()->bound('config')) {
                $configured = (string) (config('cloudbuild.backend') ?: 'auto');
                $env = (string) (config('app.env') ?: $env);
            }
        } catch (\Throwable $e) {
            $configured = (string) (getenv('CLOUDBUILD_BACKEND') ?: 'auto');
        }

        return new self($configured, $env, $cutover);
    }

    public function mode(): string
    {
        $configured = strtolower(trim((string) ($this->configured ?? 'auto')));
        if ($configured === 'local' || $configured === 'remote') {
            return $configured;
        }

        $override = $this->cutover?->backendOverride();
        if ($override === 'local' || $override === 'remote') {
            return $override;
        }

        $env = strtolower(trim((string) ($this->appEnv ?? 'production')));
        return in_array($env, ['local', 'testing'], true) ? 'local' : 'remote';
    }

    public function usesLocal(): bool
    {
        return $this->mode() === 'local';
    }

    public function backend(): CloudBuildBackend
    {
        if ($this->usesLocal()) {
            return app(CloudBuildLocalBackend::class);
        }

        return app(CloudBuildRemoteBackend::class);
    }
}
