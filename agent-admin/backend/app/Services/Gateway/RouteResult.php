<?php

namespace App\Services\Gateway;

use App\Models\CloudProvider;
use App\Models\ProviderCredential;
use App\Services\Gateway\Adapters\ProviderAdapter;

/**
 * GatewayRouter::route 的返回结构。
 *
 * 字段语义：
 *   - adapter     已选好的协议适配器实例
 *   - provider    要请求的 CloudProvider
 *   - credential  本次选中的凭证（可能为 null：池子为空、回落用 provider.api_key 时）
 *   - apiKey      实际要发给上游的 API Key 字符串（已从 credential 或 provider 取出）
 */
class RouteResult
{
    public ProviderAdapter $adapter;
    public CloudProvider $provider;
    public ?ProviderCredential $credential;
    public string $apiKey;

    public function __construct(
        ProviderAdapter $adapter,
        CloudProvider $provider,
        ?ProviderCredential $credential,
        string $apiKey
    ) {
        $this->adapter = $adapter;
        $this->provider = $provider;
        $this->credential = $credential;
        $this->apiKey = $apiKey;
    }
}
