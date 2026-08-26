<?php

namespace App\Services\Gateway\Adapters;

use App\Models\CloudProvider;
use App\Services\Gateway\Contracts\ProbeResult;
use App\Services\Gateway\Contracts\UpstreamResponse;

/**
 * 多协议适配器接口：每种服务商协议族一个实现（当前仅 OpenAI 兼容；后续按需新增原生协议适配器）。
 *
 * 适配器只负责"协议层翻译"：
 *   - 把内部 OpenAI 形态请求 → 上游对应协议的请求
 *   - 把上游响应 → 内部 OpenAI 形态响应（客户端始终只看到 OpenAI 协议）
 *
 * 不碰：
 *   - HTTP 响应构造（NewGatewayService 决定）
 *   - 计费 / 余额扣款 / UsageRecord 写入（NewGatewayService 决定）
 *   - 凭证选择（GatewayRouter 决定，本接口接收已选好的 $apiKey 字符串）
 *
 * 入参约定：
 *   - $body      原始 OpenAI 形态请求体（已经经过 CapabilityFilter 清洗）
 *   - $provider  CloudProvider 模型（含 api_base / config / capabilities 等）
 *   - $apiKey    Router 已经选好的 API Key 字符串（可能来自凭证池，也可能来自 provider.api_key）
 */
interface ProviderAdapter
{
    /**
     * 同步 chat completions 调用。
     */
    public function chat(array $body, CloudProvider $provider, string $apiKey): UpstreamResponse;

    /**
     * 流式 chat completions 调用：边收边吐到 onChunk，结束后通过 onUsage 回报 usage。
     *
     * @param callable $onChunk function(string $rawSseFragment): void
     *                          上游 SSE 原始字节直接传过来，由调用方决定是否 echo + flush。
     *                          adapter 内部会顺便解析 usage 但不修改字节流，保证客户端透明。
     * @param callable $onUsage function(array $usage): void
     *                          $usage = ['prompt_tokens' => int, 'completion_tokens' => int, 'total_tokens' => int]
     *                          解析到 usage 时调用（通常是流末尾的 chunk）；解析不到则不调。
     * @return int  上游 HTTP 状态码（用于上层判断是否计费）
     */
    public function chatStream(
        array $body,
        CloudProvider $provider,
        string $apiKey,
        callable $onChunk,
        callable $onUsage
    ): int;

    /**
     * embeddings 调用。
     */
    public function embeddings(array $body, CloudProvider $provider, string $apiKey): UpstreamResponse;

    /**
     * 图像生成 / 编辑调用。
     *
     * @param string $endpoint 'generations' | 'edits'（与 ProcessImageTaskJob 调用语义一致）
     * @param array  $body     完整 body（edits 时 body['images'] / body['mask'] 会被适配器转 multipart）
     */
    public function image(string $endpoint, array $body, CloudProvider $provider, string $apiKey): UpstreamResponse;

    /**
     * 基础探测：GET /models 等价物，验证网络 + 鉴权 + 协议格式 + 拉模型清单。
     */
    public function probeModels(CloudProvider $provider, string $apiKey, int $timeoutSeconds = 15): ProbeResult;

    /**
     * 深度探测：发一条最小 chat 调用，真正验证 /chat/completions 可用。
     *
     * @param string|null $modelId 指定 model；null 时由适配器自行 probeModels 选第一个
     */
    public function probeChat(CloudProvider $provider, string $apiKey, ?string $modelId = null, int $timeoutSeconds = 30): ProbeResult;
}
