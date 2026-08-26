<?php

namespace App\Services\SharedHub;

use Illuminate\Http\Client\Response;

/**
 * 把三个 Hub HTTP 客户端收成同一套 get/post。
 */
class ClientHubTransport implements SharedHubTransport
{
    public function __construct(private object $client)
    {
    }

    public function isReady(): bool
    {
        return (bool) $this->client->isReady();
    }

    public function get(string $path, array $query = []): SharedHubResponse
    {
        return $this->wrap($this->client->get($path, $query));
    }

    public function post(string $path, array $body = []): SharedHubResponse
    {
        return $this->wrap($this->client->post($path, $body));
    }

    private function wrap(Response $resp): SharedHubResponse
    {
        $json = $resp->json();
        return new SharedHubResponse(
            $resp->successful(),
            $resp->status(),
            is_array($json) ? $json : []
        );
    }
}
