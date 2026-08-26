<?php

namespace App\Services\CloudBuild;

use App\Models\CloudBuildClient;

/**
 * 本站点在本地执行账本中的身份。client_ref 固定为 self，避免和导入的授权端 client_id 冲突。
 */
class CloudBuildLocalSiteIdentity
{
    public const CLIENT_REF = 'self';

    public function origin(): string
    {
        foreach ([
            $this->configString('cloudbuild.agent_build.origin'),
            $this->configString('app.url'),
            trim((string) (getenv('APP_URL') ?: '')),
        ] as $candidate) {
            $origin = rtrim($candidate, '/');
            if ($origin === '' || \App\Support\RetiredPublicHosts::contains($origin)) {
                continue;
            }
            return $origin;
        }

        return 'https://localhost';
    }

    public function ensureClient(): CloudBuildClient
    {
        $existing = CloudBuildClient::query()->where('client_ref', self::CLIENT_REF)->first();
        if ($existing) {
            if ((string) ($existing->domain ?? '') === '') {
                $existing->domain = $this->origin();
                $existing->save();
            }
            return $existing;
        }

        $limit = (int) $this->configString('cloudbuild.execution.local_daily_limit', '20');
        if ($limit <= 0) {
            $limit = 20;
        }

        return CloudBuildClient::query()->create([
            'client_ref' => self::CLIENT_REF,
            'domain' => $this->origin(),
            'daily_limit' => $limit,
            'monthly_limit' => 0,
            'status' => 'active',
        ]);
    }

    private function configString(string $key, string $default = ''): string
    {
        try {
            if (function_exists('app') && app()->bound('config')) {
                $value = config($key);
                if ($value === null || $value === '') {
                    return $default;
                }
                return trim((string) $value);
            }
        } catch (\Throwable $e) {
        }

        return $default;
    }
}
