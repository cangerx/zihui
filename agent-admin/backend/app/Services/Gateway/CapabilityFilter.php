<?php

namespace App\Services\Gateway;

use App\Models\CloudProvider;

/**
 * 能力清单过滤器：在请求送入 adapter 之前，按 provider.capabilities 清洗 OpenAI 形态请求体。
 *
 * 解决两类典型兼容性问题：
 *   1. 服务商不认新字段：剥离老服务商不支持的参数（stream_options.include_usage、
 *      response_format、tools 等），避免直接被上游 400 拒绝。
 *   2. 推理模型协议变化：OpenAI o1 / o3 / gpt-5 等推理模型不接受 max_tokens、
 *      temperature、top_p 等传统参数，要求改用 max_completion_tokens。
 *
 * 解析顺序：
 *   resolveCapabilities() 把 provider.capabilities (JSON) 与 default_capabilities (config)
 *   合并；老 provider 的 capabilities 为 null 时取默认值（默认全部 true，
 *   等价 GatewayController 老代码的硬编码行为，保证零行为变化）。
 *
 * 智能补丁：
 *   即使 provider.capabilities.reasoning_params=false，filter() 也会按 model 名前缀
 *   （o1- / o3- / gpt-5- 等）自动启用推理参数语义。这是为了避免一个 provider 下
 *   同时挂普通模型 + 推理模型时，能力清单只能二选一带来的死锁。
 */
class CapabilityFilter
{
    /**
     * 清洗 chat completions 请求体。embeddings / image 不需要清洗（无相关字段）。
     */
    public function filter(array $body, CloudProvider $provider): array
    {
        $caps = $this->resolveCapabilities($provider);
        $model = (string) ($body['model'] ?? '');

        // 推理模型自动检测：即使 provider 没勾上 reasoning_params，
        // 检测到 o1- / o3- / gpt-5- 等模型名时也按推理协议改写
        $reasoningParams = $caps['reasoning_params'] || $this->isReasoningModel($model);

        // ── 0. 流式整体能力 ────────────────────────────────────
        // capabilities.stream=false 时彻底剥掉 stream/stream_options，避免上游 400。
        // 正常调用路径下 NewGatewayService::handleChat 已对 stream=true + cap.stream=false
        // 的情况返回 400 拦截；这里是兜底，覆盖直接调用 filter 的其他场景（如未来的 ProbeService）。
        if (empty($caps['stream'])) {
            unset($body['stream'], $body['stream_options']);
        }

        // ── 1. 流式 usage 字段 ─────────────────────────────────
        if (!$caps['usage_in_stream'] && isset($body['stream_options']) && is_array($body['stream_options'])) {
            unset($body['stream_options']['include_usage']);
            if (empty($body['stream_options'])) {
                unset($body['stream_options']);
            }
        }

        // ── 2. tools / function calling ─────────────────────────
        if (!$caps['tools']) {
            unset($body['tools'], $body['tool_choice'], $body['functions'], $body['function_call']);
        }

        // ── 3. response_format（json mode / json schema） ─────
        if (!$caps['json_mode']) {
            unset($body['response_format']);
        }

        // ── 4. vision：把多模态 content 退化为纯文本拼接 ──────
        if (!$caps['vision'] && isset($body['messages']) && is_array($body['messages'])) {
            foreach ($body['messages'] as $i => $msg) {
                if (!is_array($msg) || !isset($msg['content']) || !is_array($msg['content'])) {
                    continue;
                }
                $texts = [];
                foreach ($msg['content'] as $part) {
                    if (is_array($part) && ($part['type'] ?? '') === 'text') {
                        $texts[] = (string) ($part['text'] ?? '');
                    }
                }
                $body['messages'][$i]['content'] = implode("\n", $texts);
            }
        }

        // ── 5. 推理模型参数改写 ─────────────────────────────────
        if ($reasoningParams) {
            // OpenAI 推理系列：max_tokens 已弃用，改用 max_completion_tokens
            if (array_key_exists('max_tokens', $body) && !array_key_exists('max_completion_tokens', $body)) {
                $body['max_completion_tokens'] = $body['max_tokens'];
            }
            unset($body['max_tokens']);

            // 推理模型不接受这些采样参数（传了会 400）
            unset(
                $body['temperature'],
                $body['top_p'],
                $body['presence_penalty'],
                $body['frequency_penalty'],
                $body['logprobs'],
                $body['top_logprobs']
            );
        }

        return $body;
    }

    /**
     * 合并 default_capabilities (config) 与 provider.capabilities (DB JSON)，
     * 后者覆盖前者；二者都缺失的项保持 default。
     */
    public function resolveCapabilities(CloudProvider $provider): array
    {
        $defaults = (array) config('gateway.default_capabilities', [
            'stream'           => true,
            'usage_in_stream'  => true,
            'tools'            => true,
            'vision'           => true,
            'json_mode'        => true,
            'reasoning_params' => false,
        ]);

        $caps = $provider->capabilities ?? null;
        if (is_string($caps)) {
            $decoded = json_decode($caps, true);
            $caps = is_array($decoded) ? $decoded : [];
        } elseif (!is_array($caps)) {
            $caps = [];
        }

        return array_merge($defaults, $caps);
    }

    /**
     * 判断 model 名是否属于"推理模型"族，需要走 max_completion_tokens 语义。
     *
     * 覆盖：OpenAI o1 / o1-mini / o1-preview / o3 / o3-mini / o4 / gpt-5 系列。
     * 国内各家如出现新协议，按需扩充。
     */
    public function isReasoningModel(string $model): bool
    {
        $lower = strtolower(trim($model));
        if ($lower === '') return false;

        // 严格前缀匹配，避免误伤包含 'o1' 字串的非推理模型名
        $prefixes = ['o1-', 'o3-', 'o4-', 'gpt-5-', 'gpt-5o', 'gpt-5'];
        foreach ($prefixes as $p) {
            if (str_starts_with($lower, $p)) return true;
        }
        // 单独的 'o1' / 'o3' / 'o4' 兼容
        return in_array($lower, ['o1', 'o3', 'o4', 'gpt-5'], true);
    }
}
