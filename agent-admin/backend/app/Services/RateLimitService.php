<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\Cache;

class RateLimitService
{
    public function assertAllowed(User $user, string $scope, array $limits): void
    {
        $rpm = (int)($limits[$scope]['rpm'] ?? $limits['rpm'] ?? 0);
        if ($rpm > 0) {
            $this->hitWindow("rl:{$scope}:rpm:user:{$user->id}", $rpm, 60);
        }
    }

    public function effectiveLimits(User $user, string $scope, array $policies): array
    {
        $raw = $policies['rate_limit'] ?? $policies['rate_limit_json'] ?? [];
        if (is_string($raw)) {
            $decoded = json_decode($raw, true);
            $raw = is_array($decoded) ? $decoded : [];
        }
        if (!is_array($raw)) $raw = [];

        $scopeLimits = isset($raw[$scope]) && is_array($raw[$scope]) ? $raw[$scope] : [];
        return [
            $scope => [
                'rpm' => (int)($scopeLimits['rpm'] ?? $raw['rpm'] ?? 0),
                'tpm' => (int)($scopeLimits['tpm'] ?? $raw['tpm'] ?? 0),
                'concurrency' => (int)($scopeLimits['concurrency'] ?? $raw['concurrency'] ?? 0),
            ],
        ];
    }

    private function hitWindow(string $key, int $limit, int $ttlSeconds): void
    {
        $count = (int)Cache::get($key, 0);
        if ($count >= $limit) {
            throw new \RuntimeException('Rate limit exceeded');
        }
        if ($count <= 0) {
            Cache::put($key, 1, $ttlSeconds);
        } else {
            Cache::increment($key);
        }
    }
}
