<?php

namespace App\Services\Gateway\Contracts;

/**
 * 适配器执行健康探测（基础 GET /models / 深度 POST /chat/completions）的统一返回结构。
 *
 * 与现有 ProviderProbe 返回的 ['status', 'message', 'http_status', 'endpoint', 'models', 'model']
 * 对应。本结构作为新链路的内部 DTO 使用，对外（CloudProviderController）通过 toArray()
 * 转回与现状字段名一致的数组，前端 / API 契约零变化。
 *
 * 字段语义：
 *   - status      'ok' | 'warning' | 'error'
 *                 ok      = HTTP 2xx 且响应符合协议
 *                 warning = HTTP 2xx 但协议不规范，或 403 端点白名单（中转 API 常见）
 *                 error   = 401/404/5xx 或连接异常
 *   - message     人话提示
 *   - httpStatus  上游 HTTP 状态码（连接异常时 null）
 *   - endpoint    实际请求的 URL
 *   - models      probeModels 命中 OpenAI 协议时附带 data 数组（供 fetchModels / probeChat 复用）
 *   - model       probeChat 用到的具体 model id
 */
class ProbeResult
{
    public string $status;
    public string $message;
    public ?int $httpStatus;
    public ?string $endpoint;
    public array $models;
    public ?string $model;

    public function __construct(
        string $status,
        string $message,
        ?int $httpStatus = null,
        ?string $endpoint = null,
        array $models = [],
        ?string $model = null
    ) {
        $this->status = $status;
        $this->message = $message;
        $this->httpStatus = $httpStatus;
        $this->endpoint = $endpoint;
        $this->models = $models;
        $this->model = $model;
    }

    public static function ok(string $message, ?int $httpStatus, string $endpoint, array $models = [], ?string $model = null): self
    {
        return new self('ok', $message, $httpStatus, $endpoint, $models, $model);
    }

    public static function warning(string $message, ?int $httpStatus, string $endpoint, array $models = []): self
    {
        return new self('warning', $message, $httpStatus, $endpoint, $models);
    }

    public static function error(string $message, ?int $httpStatus, string $endpoint): self
    {
        return new self('error', $message, $httpStatus, $endpoint);
    }

    /**
     * 转成与现有 ProviderProbe 返回数组兼容的形状，确保 CloudProviderController
     * 切到新链路时前端 / API 契约零变化。
     */
    public function toArray(): array
    {
        $arr = [
            'status'      => $this->status,
            'message'     => $this->message,
            'http_status' => $this->httpStatus,
            'endpoint'    => $this->endpoint ?? '',
        ];
        if (!empty($this->models)) {
            $arr['models'] = $this->models;
        }
        if ($this->model !== null) {
            $arr['model'] = $this->model;
        }
        return $arr;
    }

    /**
     * 从 ProviderProbe 现有数组结构构造 ProbeResult，
     * 供 OpenAICompatibleAdapter 复用 ProviderProbe 时桥接使用。
     */
    public static function fromLegacyArray(array $data): self
    {
        return new self(
            $data['status'] ?? 'error',
            $data['message'] ?? '',
            $data['http_status'] ?? null,
            $data['endpoint'] ?? null,
            $data['models'] ?? [],
            $data['model'] ?? null
        );
    }
}
