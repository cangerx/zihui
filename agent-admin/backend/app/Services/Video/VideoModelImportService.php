<?php

namespace App\Services\Video;

use App\Models\VideoModelSpec;
use App\Models\VideoProviderAccount;
use App\Models\VideoSkuPrice;
use Illuminate\Support\Facades\DB;

class VideoModelImportService
{
    public function import(VideoProviderAccount $account, array $models, float $defaultCreditCost): array
    {
        $template = $this->templateFor($account);
        $created = [];
        $failures = [];

        foreach ($models as $item) {
            $modelId = trim((string) $item['id']);
            try {
                $created[] = DB::transaction(fn() => $this->createModelAndSku(
                    $account,
                    $modelId,
                    trim((string) ($item['name'] ?? '')) ?: $modelId,
                    $defaultCreditCost,
                    $template
                ));
            } catch (\Throwable $e) {
                $failures[] = ['id' => $modelId, 'error' => $e->getMessage()];
            }
        }

        return ['created' => $created, 'failures' => $failures];
    }

    private function createModelAndSku(VideoProviderAccount $account, string $modelId, string $displayName, float $creditCost, array $template): array
    {
        if (VideoModelSpec::where('provider_key', $account->provider_key)->where('model_id', $modelId)->exists()) {
            throw new \InvalidArgumentException('该服务商下已存在相同 model_id');
        }
        $spec = VideoModelSpec::create([
            'provider_key' => $account->provider_key,
            'provider_protocol' => $template['provider_protocol'],
            'model_id' => $modelId,
            'display_name' => $displayName,
            'generation_type' => $template['generation_type'] ?? 'text_or_image_to_video',
            'status' => 'active',
            'supported_modes' => $template['supported_modes'] ?? ['text_to_video', 'image_to_video'],
            'supported_durations' => $template['supported_durations'] ?? [5],
            'supported_resolutions' => $template['supported_resolutions'] ?? ['720p', '1080p'],
            'supported_aspect_ratios' => $template['supported_aspect_ratios'] ?? ['16:9', '9:16', '1:1'],
            'max_reference_images' => $template['max_reference_images'] ?? 1,
            'provider_params' => $template['provider_params'],
            'description' => '',
            'sort_order' => 0,
        ]);
        $skuData = [
            'video_model_spec_id' => $spec->id,
            'provider_key' => $spec->provider_key,
            'provider_protocol' => $spec->provider_protocol,
            'model_id' => $spec->model_id,
            'title' => $displayName . ' 默认规格',
            'mode' => '', 'duration_seconds' => $template['default_duration'] ?? 5, 'resolution' => $template['default_resolution'] ?? '720p',
            'aspect_ratio' => '', 'quality' => '',
            'default_credit_cost' => $creditCost,
            'price_label' => (string) $creditCost,
            'provider_cost_text' => '', 'provider_cost_source' => '', 'provider_params' => [],
            'status' => 'active', 'sort_order' => 0,
        ];
        $skuData['sku_key'] = $this->skuKey($spec, $skuData);
        $candidate = new VideoSkuPrice($skuData);
        $candidate->setRelation('modelSpec', $spec);
        app(VideoSkuSupportService::class)->assertSkuSupported($candidate);
        $sku = VideoSkuPrice::create($skuData);

        return ['model' => $spec->fresh(), 'sku' => $sku->fresh('modelSpec')];
    }

    private function templateFor(VideoProviderAccount $account): array
    {
        return match (app(VideoProviderManager::class)->driverKey($account)) {
            'wan' => ['provider_protocol' => 'wan', 'provider_params' => []],
            'duomi' => ['provider_protocol' => 'seedance', 'provider_params' => []],
            'volcengine_ark' => [
                'provider_protocol' => 'volcengine_ark',
                'generation_type' => 'multimodal_video',
                'supported_modes' => ['text_to_video', 'image_to_video', 'first_last_frame'],
                'supported_durations' => [5, 10, 15],
                'supported_resolutions' => ['720p', '1080p'],
                'supported_aspect_ratios' => ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
                'max_reference_images' => 9,
                'default_duration' => 5,
                'default_resolution' => '720p',
                'provider_params' => [
                    'submit_path' => '/api/v3/contents/generations/tasks',
                    'query_path' => '/api/v3/contents/generations/tasks/{task_id}',
                    'ref_media' => ['image', 'video', 'audio'],
                ],
            ],
            'minimax_h3' => [
                'provider_protocol' => 'minimax_h3',
                'generation_type' => 'multimodal_video',
                'supported_modes' => ['text_to_video', 'image_to_video', 'first_last_frame'],
                'supported_durations' => [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
                'supported_resolutions' => ['768P', '2K'],
                'supported_aspect_ratios' => ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
                'max_reference_images' => 2,
                'default_duration' => 5,
                'default_resolution' => '768P',
                'provider_params' => [
                    'submit_path' => '/v2/video_generation',
                    'query_path' => '/v2/query/video_generation/{task_id}',
                    'ref_media' => ['image', 'video', 'audio'],
                ],
            ],
            default => [
                'provider_protocol' => 'openai_video',
                'provider_params' => array_filter([
                    'contract' => $account->provider_key === 'cang-api' ? 'cang_native' : null,
                    'submit_path' => '/v1/videos',
                    'query_path' => '/v1/videos/{task_id}',
                    'ref_media' => ['image', 'video'],
                ], fn($value) => $value !== null),
            ],
        };
    }

    private function skuKey(VideoModelSpec $spec, array $payload): string
    {
        $base = implode(':', array_filter([
            $spec->provider_key, $spec->model_id,
            ((int) $payload['duration_seconds']) . 's', $payload['resolution'],
        ], fn($value) => $value !== ''));
        $suffix = substr(md5(uniqid('', true)), 0, 6);
        $key = $base . ':' . $suffix;
        return mb_strlen($key) <= 190
            ? $key
            : $spec->provider_key . ':' . substr(md5($base), 0, 12) . ':' . $suffix;
    }
}
