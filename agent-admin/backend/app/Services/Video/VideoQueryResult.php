<?php

namespace App\Services\Video;

class VideoQueryResult
{
    public function __construct(
        public bool $ok,
        public string $status = 'running',
        public string $providerStatus = '',
        public int $progress = 0,
        public string $videoUrl = '',
        public string $coverUrl = '',
        public array $metadata = [],
        public array $response = [],
        public string $errorCode = '',
        public string $errorMessage = ''
    ) {}

    public static function ok(string $status, string $providerStatus, int $progress, string $videoUrl, string $coverUrl, array $metadata, array $response): self
    {
        return new self(true, $status, $providerStatus, $progress, $videoUrl, $coverUrl, $metadata, $response);
    }

    public static function fail(string $errorMessage, string $errorCode = '', array $response = [], string $providerStatus = ''): self
    {
        return new self(false, 'failed', $providerStatus, 0, '', '', [], $response, $errorCode, $errorMessage);
    }
}
