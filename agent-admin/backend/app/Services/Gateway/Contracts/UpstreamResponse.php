<?php

namespace App\Services\Gateway\Contracts;

/**
 * 适配器调用上游（chat / embeddings / image）的统一返回结构。
 *
 * 不携带任何 HTTP / 计费 / 用户信息——adapter 只管协议层翻译，
 * 上层 NewGatewayService 拿到本结构后再决定 HTTP 响应、计费扣款、UsageRecord 写入。
 *
 * 字段语义：
 *   - ok            HTTP 2xx 且响应符合协议时为 true，其他一律 false
 *   - statusCode    上游 HTTP 状态码（连接异常时为 0）
 *   - data          上游响应 JSON（解析后）；ok=false 时若上游返回了 JSON 错误体也保留在此
 *   - errorMessage  统一的人话错误描述（连接异常 / 协议不规范 / 4xx/5xx 都翻译成中文）
 *   - usage         从 data 里抽取的 ['prompt_tokens', 'completion_tokens', 'total_tokens']
 *                   不存在时为空数组；流式响应里 usage 由 onUsage callback 单独回报，本字段留空
 */
class UpstreamResponse
{
    public bool $ok;
    public int $statusCode;
    public ?array $data;
    public ?string $errorMessage;
    public array $usage;

    public function __construct(
        bool $ok,
        int $statusCode,
        ?array $data,
        ?string $errorMessage = null,
        array $usage = []
    ) {
        $this->ok = $ok;
        $this->statusCode = $statusCode;
        $this->data = $data;
        $this->errorMessage = $errorMessage;
        $this->usage = $usage;
    }

    public static function ok(int $statusCode, array $data, array $usage = []): self
    {
        return new self(true, $statusCode, $data, null, $usage);
    }

    public static function fail(int $statusCode, ?array $data, string $errorMessage): self
    {
        return new self(false, $statusCode, $data, $errorMessage, []);
    }
}
