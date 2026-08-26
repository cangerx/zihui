<?php

namespace App\Services\SharedHub;

class SharedHubResponse
{
    /**
     * @param array<string, mixed> $json
     */
    public function __construct(
        public readonly bool $ok,
        public readonly int $status,
        public readonly array $json
    ) {
    }

    public function error(): string
    {
        $err = $this->json['error'] ?? $this->json['message'] ?? '';
        return is_string($err) && $err !== '' ? $err : ('http_' . $this->status);
    }
}
