<?php

namespace App\Services\SharedHub;

interface SharedHubTransport
{
    public function isReady(): bool;

    /** @param array<string, mixed> $query */
    public function get(string $path, array $query = []): SharedHubResponse;

    /** @param array<string, mixed> $body */
    public function post(string $path, array $body = []): SharedHubResponse;
}
