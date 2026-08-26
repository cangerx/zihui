<?php

namespace App\Services;

use App\Models\CloudModel;
use App\Models\Inspiration;
use App\Services\Gateway\GatewayRouter;
use RuntimeException;

class CreativeTemplateAiService
{
    private const FIELD_TYPES = ['text', 'textarea', 'select', 'multi_select'];
    private const TEMPLATE_ANALYSIS_SYSTEM_PROMPT = "你是专业的 AI 生图创意模板设计师。请把用户提供的完整提示词改写成可复用模板，只抽取 3 到 10 个用户真正需要填写的变量。\n只返回 JSON，不要 Markdown。JSON 字段：title, description, prompt_template, requires_ref_image, variables。\n不要返回 default_size，不要推断或填写图片尺寸、图片比例、宽高比、分辨率、像素尺寸。\n如果原提示词里包含图片尺寸、图片比例、宽高比、分辨率、像素尺寸等内容，不要拆成变量或选项，也不要保留在 prompt_template 中。\n如果原提示词里包含是否需要上传参考图、参考图要求等内容，只用于判断 requires_ref_image；不要拆成变量或选项，也不要保留在 prompt_template 中。\nvariables 每项字段：key, label, type, required, placeholder, default, options。type 只能是 text、textarea、select、multi_select。\nprompt_template 用 {{key}} 作为变量占位符，并保留原提示词的主体、风格、构图、材质、光影、质量要求等真正用于生图的描述。";

    public function analyzePrompt(string $prompt, ?int $cloudModelId = null): array
    {
        $prompt = trim($prompt);
        if ($prompt === '') {
            throw new RuntimeException('提示词不能为空');
        }

        $fallback = $this->heuristicDraft($prompt);
        $cloudModel = $this->resolveChatModel($cloudModelId);
        if (!$cloudModel) {
            $fallback['ai_used'] = false;
            return $fallback;
        }

        $messages = [
            [
                'role' => 'system',
                'content' => self::TEMPLATE_ANALYSIS_SYSTEM_PROMPT,
            ],
            [
                'role' => 'user',
                'content' => $prompt,
            ],
        ];

        $lastError = null;
        for ($attempt = 0; $attempt < 2; $attempt++) {
            try {
                $content = $this->callChatModel($cloudModel, $messages, 1800, true, 1);
                $draft = $this->parseDraftJson($content, $fallback, $attempt === 0);
                $draft['ai_used'] = true;
                return $draft;
            } catch (RuntimeException $e) {
                $lastError = $e;
            }
        }

        throw $lastError ?: new RuntimeException('AI 拆解失败');
    }

    public function reverseImage(string $dataUri, ?int $cloudModelId = null, string $hint = ''): array
    {
        $cloudModel = $this->resolveChatModel($cloudModelId);
        if (!$cloudModel) {
            throw new RuntimeException('请先配置或选择可用于图片反推的对话模型');
        }

        $reversedPrompt = $this->callChatModel($cloudModel, [
            [
                'role' => 'system',
                'content' => '你是专业的图片反推提示词专家。根据图片内容生成一段完整、可用于 AI 生图的提示词，准确描述主体、场景、构图、风格、材质、光影、镜头和质量要求。只输出提示词正文，不要 JSON，不要 Markdown。',
            ],
            [
                'role' => 'user',
                'content' => [
                    [
                        'type' => 'text',
                        'text' => $hint !== '' ? ('补充说明：' . $hint) : '请反推这张图片并生成创意模板。',
                    ],
                    [
                        'type' => 'image_url',
                        'image_url' => ['url' => $dataUri],
                    ],
                ],
            ],
        ], 1600, false);

        $draft = $this->analyzePrompt($reversedPrompt, $cloudModelId);
        $draft['ai_used'] = true;
        $draft['reversed_prompt'] = $reversedPrompt;
        return $draft;
    }

    public function draftFromInspiration(Inspiration $inspiration, ?int $cloudModelId = null): array
    {
        $prompt = trim((string) ($inspiration->prompt_cn ?: $inspiration->prompt_en));
        if ($prompt === '') {
            throw new RuntimeException('该灵感没有可用于生成模板的提示词');
        }

        $draft = $this->analyzePrompt($prompt, $cloudModelId);
        $refImages = is_array($inspiration->ref_images) ? $inspiration->ref_images : [];
        if (!$refImages && $inspiration->cover_image) {
            $refImages = [$inspiration->cover_image];
        }

        $draft['title'] = $this->limitText((string) $inspiration->title, 100) ?: $draft['title'];
        $draft['cover_image'] = (string) ($inspiration->cover_image ?? '');
        $draft['example_ref_images'] = array_values(array_slice(array_filter($refImages, fn($v) => is_string($v) && trim($v) !== ''), 0, 8));
        $draft['default_size'] = '';
        $draft['source_type'] = 'inspiration';
        $draft['source_inspiration_id'] = $inspiration->id;
        return $draft;
    }

    public function normalizeDraft(array $draft, string $fallbackPrompt = ''): array
    {
        $promptTemplate = trim((string) ($draft['prompt_template'] ?? ''));
        if ($promptTemplate === '') {
            $promptTemplate = trim($fallbackPrompt) !== '' ? trim($fallbackPrompt) : '主体：{{subject}}，风格：{{style}}，场景：{{scene}}';
        }

        return [
            'title' => $this->limitText((string) ($draft['title'] ?? '创意模板'), 100),
            'description' => $this->limitText((string) ($draft['description'] ?? ''), 500),
            'prompt_template' => $this->stripBuiltInTemplateOptionText($promptTemplate) ?: '主体：{{subject}}，风格：{{style}}，场景：{{scene}}',
            'default_size' => '',
            'requires_ref_image' => array_key_exists('requires_ref_image', $draft) ? (bool) $draft['requires_ref_image'] : $this->detectRequiresRefImage($fallbackPrompt),
            'variables' => $this->normalizeVariables((array) ($draft['variables'] ?? [])),
        ];
    }

    public function normalizeVariables(array $variables): array
    {
        $result = [];
        $used = [];
        foreach ($variables as $index => $item) {
            if (!is_array($item)) continue;
            if ($this->isBuiltInTemplateOptionVariable($item)) continue;
            $key = $this->normalizeKey((string) ($item['key'] ?? ''), $index + 1);
            while (isset($used[$key])) {
                $key .= '_' . (count($used) + 1);
            }
            $used[$key] = true;
            $type = (string) ($item['type'] ?? 'text');
            if (!in_array($type, self::FIELD_TYPES, true)) {
                $type = 'text';
            }
            $options = $this->normalizeOptions($item['options'] ?? []);
            if (($type === 'select' || $type === 'multi_select') && !$options) {
                $type = 'text';
            }
            $result[] = [
                'key' => $key,
                'label' => $this->limitText((string) ($item['label'] ?? $key), 30),
                'type' => $type,
                'required' => (bool) ($item['required'] ?? true),
                'placeholder' => $this->limitText((string) ($item['placeholder'] ?? ''), 120),
                'default' => $this->limitText((string) ($item['default'] ?? ''), 500),
                'options' => $options,
            ];
            if (count($result) >= 10) break;
        }

        $presets = [
            ['key' => 'subject', 'label' => '主体', 'type' => 'text', 'required' => true, 'placeholder' => '例如：一位年轻女性、产品海报、室内空间', 'default' => '', 'options' => []],
            ['key' => 'style', 'label' => '风格', 'type' => 'text', 'required' => true, 'placeholder' => '例如：写实摄影、国潮插画、极简商业', 'default' => '', 'options' => []],
            ['key' => 'scene', 'label' => '场景', 'type' => 'text', 'required' => true, 'placeholder' => '例如：黄昏街道、纯色影棚、自然森林', 'default' => '', 'options' => []],
        ];
        foreach ($presets as $preset) {
            if (count($result) >= 3) break;
            if (isset($used[$preset['key']])) continue;
            $result[] = $preset;
            $used[$preset['key']] = true;
        }

        return array_values(array_slice($result, 0, 10));
    }

    private function isBuiltInTemplateOptionVariable(array $item): bool
    {
        $key = strtolower((string) ($item['key'] ?? ''));
        $options = is_array($item['options'] ?? null) ? $item['options'] : [];
        $text = implode(' ', array_map(fn($v) => is_scalar($v) ? (string) $v : '', array_merge([
            $item['label'] ?? '',
            $item['placeholder'] ?? '',
            $item['default'] ?? '',
        ], $options)));
        if (preg_match('/(^|_)(default_)?(image_)?(size|ratio|aspect|aspect_ratio|resolution|dimension|width|height)(_|$)/i', $key)) return true;
        if (preg_match('/(^|_)(ref|reference)(_?image)?(_?required)?(_?upload)?(_|$)|requires?_ref_image|upload_ref_image/i', $key)) return true;
        return (bool) preg_match('/((默认)?(生成|图片|画面|输出)?(尺寸|比例|宽高比|长宽比|分辨率)|参考图|参考图片|上传.{0,8}(图片|参考图)|是否.{0,8}参考图|需要.{0,8}参考图)/u', $text);
    }

    private function stripBuiltInTemplateOptionText(string $text): string
    {
        $parts = preg_split('/[,，;；。\n]+/u', $text) ?: [];
        $result = [];
        foreach ($parts as $part) {
            $part = trim($part);
            if ($part === '' || $this->isBuiltInTemplateOptionSegment($part)) continue;
            $result[] = $part;
        }
        return trim(implode('，', $result));
    }

    private function isBuiltInTemplateOptionSegment(string $segment): bool
    {
        return (bool) preg_match('/((默认)?(生成|图片|画面|输出)?(尺寸|比例|宽高比|长宽比|分辨率)|\b(aspect\s*ratio|image\s*size|output\s*size|resolution|dimensions?)\b|\b\d+\s*[:：]\s*\d+\b|\b\d{3,5}\s*[x×]\s*\d{3,5}\b|参考图|参考图片|上传.{0,8}(图片|参考图)|reference\s+image|image\s+reference|ref\s+image)/iu', $segment);
    }

    private function detectRequiresRefImage(string $text): bool
    {
        return (bool) preg_match('/(需要|必须|请|上传|提供|使用|基于|参考).{0,12}(参考图|参考图片|图片参考|reference image|ref image|image reference)/iu', $text);
    }

    public function availableModels(): array
    {
        return CloudModel::query()
            ->join('cloud_providers as p', 'p.id', '=', 'cloud_models.provider_id')
            ->where('cloud_models.type', 'chat')
            ->where('cloud_models.status', 'active')
            ->where('p.status', 'active')
            ->orderBy('p.id')
            ->orderBy('cloud_models.id')
            ->get([
                'cloud_models.id',
                'cloud_models.provider_id',
                'cloud_models.model_id',
                'cloud_models.name',
                'p.name as provider_name',
                'p.capabilities as provider_capabilities',
            ])
            ->map(function ($row) {
                $caps = is_string($row->provider_capabilities) ? json_decode($row->provider_capabilities, true) : $row->provider_capabilities;
                return [
                    'id' => (int) $row->id,
                    'provider_id' => (int) $row->provider_id,
                    'model_id' => (string) $row->model_id,
                    'name' => (string) ($row->name ?: $row->model_id),
                    'provider_name' => (string) $row->provider_name,
                    'vision' => is_array($caps) ? (bool) ($caps['vision'] ?? true) : true,
                ];
            })
            ->values()
            ->all();
    }

    private function resolveChatModel(?int $cloudModelId): ?CloudModel
    {
        $query = CloudModel::with('provider')
            ->where('type', 'chat')
            ->where('status', 'active');

        if ($cloudModelId && $cloudModelId > 0) {
            $model = (clone $query)->where('id', $cloudModelId)->first();
            if (!$model) {
                throw new RuntimeException('选择的模型不可用');
            }
            return $model;
        }

        return $query
            ->whereHas('provider', fn($q) => $q->where('status', 'active'))
            ->orderBy('id')
            ->first();
    }

    private function callChatModel(CloudModel $cloudModel, array $messages, int $maxTokens, bool $jsonMode = true, int $maxAttempts = 2): string
    {
        $router = app(GatewayRouter::class);
        $route = $router->route($cloudModel);
        if (!$route->apiKey) {
            throw new RuntimeException('模型服务未配置 API Key');
        }

        $body = [
            'model' => $cloudModel->model_id,
            'messages' => $messages,
            'temperature' => 0.2,
            'max_tokens' => $maxTokens,
        ];
        if ($jsonMode) {
            $body['response_format'] = ['type' => 'json_object'];
        }

        $attempts = max(1, $maxAttempts);
        $lastError = null;
        for ($attempt = 0; $attempt < $attempts; $attempt++) {
            $resp = $route->adapter->chat($body, $route->provider, $route->apiKey);
            if (!$resp->ok) {
                $lastError = new RuntimeException($resp->errorMessage ?: 'AI 调用失败');
                $router->markCredentialFailure($route->credential, $resp->errorMessage ?: 'creative template ai failed');
                continue;
            }

            $content = $resp->data['choices'][0]['message']['content'] ?? '';
            if (is_array($content)) {
                $parts = [];
                foreach ($content as $part) {
                    if (is_array($part) && isset($part['text'])) $parts[] = (string) $part['text'];
                }
                $content = implode("\n", $parts);
            }
            $content = trim((string) $content);
            if ($content === '') {
                $lastError = new RuntimeException('AI 返回内容为空');
                continue;
            }

            $router->markCredentialSuccess($route->credential);
            return $content;
        }

        throw $lastError ?: new RuntimeException('AI 调用失败');
    }

    private function parseDraftJson(string $content, array $fallback, bool $throwOnFailure = false): array
    {
        $data = json_decode($content, true);
        if (!is_array($data)) {
            if (preg_match('/\{.*\}/s', $content, $m)) {
                $data = json_decode($m[0], true);
            }
        }
        if (!is_array($data)) {
            if ($throwOnFailure) {
                throw new RuntimeException('AI 返回内容不是有效 JSON');
            }
            return $fallback;
        }
        return $this->normalizeDraft($data, (string) ($fallback['prompt_template'] ?? ''));
    }

    private function heuristicDraft(string $prompt): array
    {
        return $this->normalizeDraft([
            'title' => $this->guessTitle($prompt),
            'description' => '根据原始提示词生成的创意模板',
            'prompt_template' => "主体：{{subject}}\n风格：{{style}}\n场景：{{scene}}\n要求：" . $prompt,
            'variables' => [],
        ], $prompt);
    }

    private function guessTitle(string $prompt): string
    {
        $text = trim(preg_replace('/\s+/u', ' ', $prompt) ?: $prompt);
        return $this->limitText($text !== '' ? $text : '创意模板', 30);
    }

    private function normalizeKey(string $key, int $index): string
    {
        $key = strtolower(trim($key));
        $key = preg_replace('/[^a-z0-9_]+/', '_', $key) ?: '';
        $key = trim($key, '_');
        if ($key === '') $key = 'field_' . $index;
        if (preg_match('/^[0-9]/', $key)) $key = 'field_' . $key;
        return $key;
    }

    private function normalizeOptions($options): array
    {
        if (!is_array($options)) return [];
        $result = [];
        foreach ($options as $option) {
            $value = is_array($option) ? (string) ($option['label'] ?? $option['value'] ?? '') : (string) $option;
            $value = $this->limitText(trim($value), 50);
            if ($value !== '' && !in_array($value, $result, true)) {
                $result[] = $value;
            }
            if (count($result) >= 20) break;
        }
        return $result;
    }

    private function limitText(string $text, int $limit): string
    {
        $text = trim($text);
        if (function_exists('mb_substr')) {
            return mb_substr($text, 0, $limit);
        }
        return substr($text, 0, $limit);
    }
}
