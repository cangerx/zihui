<?php

namespace App\Services\Video;

class VideoSubmitResult
{
    public function __construct(
        public bool $ok,
        public string $providerTaskId = '',
        public string $providerStatus = '',
        public array $response = [],
        public string $errorCode = '',
        public string $errorMessage = '',
        public array $submitPayload = []
    ) {}

    public static function ok(string $providerTaskId, string $providerStatus, array $response, array $submitPayload = []): self
    {
        return new self(true, $providerTaskId, $providerStatus, $response, '', '', $submitPayload);
    }

    public static function fail(string $errorMessage, string $errorCode = '', array $response = [], array $submitPayload = []): self
    {
        return new self(false, '', '', $response, $errorCode, $errorMessage, $submitPayload);
    }
}
