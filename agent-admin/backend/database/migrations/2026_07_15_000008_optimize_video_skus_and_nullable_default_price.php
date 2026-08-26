<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            return;
        }
        if (!Schema::hasTable('video_sku_prices') || !Schema::hasTable('video_model_specs')) {
            return;
        }

        DB::statement('ALTER TABLE video_sku_prices MODIFY default_credit_cost DECIMAL(16,6) NULL DEFAULT NULL');

        $this->syncModels();
        $this->syncSeedanceSkus();
        $this->syncVeoSkus();
        $this->syncGrokSkus();
        $this->clearLegacyPlaceholderPrices();

        DB::table('video_sku_prices')
            ->where('sku_key', 'duomi:grok-video:default')
            ->update([
                'status' => 'disabled',
                'default_credit_cost' => null,
                'price_label' => '',
                'updated_at' => now(),
            ]);
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            return;
        }
        if (!Schema::hasTable('video_sku_prices')) {
            return;
        }

        DB::table('video_sku_prices')
            ->whereNull('default_credit_cost')
            ->update(['default_credit_cost' => 0, 'updated_at' => now()]);

        DB::statement('ALTER TABLE video_sku_prices MODIFY default_credit_cost DECIMAL(16,6) NOT NULL DEFAULT 0');
    }

    private function syncModels(): void
    {
        $this->upsertModel('doubao-seedance-2-0-260128', 'seedance', 'Seedance 2.0', 'multimodal_video', ['standard'], [5, 10, 15], ['720p', '1080p'], ['16:9', '9:16', '1:1'], 3, '多米 Seedance 2.0 官方格式，按秒计费。', 10, 'https://duomiapi.com/doc/105', '/api/v3/contents/generations/tasks', '/api/v3/contents/generations/tasks/{task_id}');
        $this->upsertModel('doubao-seedance-2-0-fast-260128', 'seedance', 'Seedance 2.0 Fast', 'multimodal_video', ['fast'], [5, 10, 15], ['720p', '1080p'], ['16:9', '9:16', '1:1'], 3, '多米 Seedance 2.0 Fast 官方格式，按秒计费。', 20, 'https://duomiapi.com/doc/105', '/api/v3/contents/generations/tasks', '/api/v3/contents/generations/tasks/{task_id}');
        $this->upsertModel('veo3.1-fast', 'veo', 'VEO 3.1 Fast', 'text_or_image_to_video', ['text_to_video', 'image_to_video', 'first_last_frame'], [8], ['720p', '1080p', '4k'], ['16:9', '9:16'], 2, '多米 VEO 3.1 Fast 视频生成。', 30, 'https://duomiapi.com/doc/98', '/v1/videos/generations', '/v1/videos/tasks/{task_id}');
        $this->upsertModel('veo3.1-pro', 'veo', 'VEO 3.1 Pro', 'text_or_image_to_video', ['text_to_video', 'image_to_video', 'first_last_frame'], [8], ['720p', '1080p', '4k'], ['16:9', '9:16'], 2, '多米 VEO 3.1 Pro 视频生成。', 40, 'https://duomiapi.com/doc/98', '/v1/videos/generations', '/v1/videos/tasks/{task_id}');
        $this->upsertModel('grok-video', 'grok', 'GROK Video', 'text_to_video', ['text_to_video'], [6, 10, 15, 20, 25, 30], ['720p'], ['2:3', '3:2', '1:1', '9:16', '16:9'], 7, '多米 GROK Video，价格以多米 Apifox/控制台为准。', 50, 'https://duomiapi.com/doc/98', '/v1/videos/generations', '/v1/videos/tasks/{task_id}');
    }

    private function syncSeedanceSkus(): void
    {
        $models = [
            'doubao-seedance-2-0-260128' => ['name' => 'Seedance 2.0', 'mode' => 'standard', 'offset' => 0],
            'doubao-seedance-2-0-fast-260128' => ['name' => 'Seedance 2.0 Fast', 'mode' => 'fast', 'offset' => 100],
        ];
        $durations = [5, 10, 15];
        $resolutions = ['720p', '1080p'];
        $ratios = ['16:9', '9:16', '1:1'];

        foreach ($models as $modelId => $meta) {
            foreach ($durations as $durationIndex => $duration) {
                foreach ($resolutions as $resolutionIndex => $resolution) {
                    foreach ($ratios as $ratioIndex => $ratio) {
                        $legacy = in_array($duration, [5, 10], true) && $resolution === '1080p' && $ratio === '16:9';
                        $skuKey = $legacy ? 'duomi:' . $modelId . ':' . $duration . 's:standard' : $this->skuKey($modelId, (string)$meta['mode'], $duration, $resolution, $ratio);
                        $this->upsertSku($modelId, $skuKey, (string)$meta['name'] . ' ' . $this->modeLabel((string)$meta['mode']) . ' ' . $duration . '秒 ' . $resolution . ' ' . $ratio, 'seedance', (string)$meta['mode'], $duration, $resolution, $ratio, '¥' . $duration . '/次（多米 doc/105：1元/秒）', 'https://duomiapi.com/doc/105', 1000 + (int)$meta['offset'] + $durationIndex * 30 + $resolutionIndex * 10 + $ratioIndex);
                    }
                }
            }
        }
    }

    private function syncVeoSkus(): void
    {
        $models = [
            'veo3.1-fast' => ['name' => 'VEO 3.1 Fast', 'costs' => ['720p' => '¥0.20/次', '1080p' => '¥0.40/次', '4k' => '¥0.50/次'], 'offset' => 0],
            'veo3.1-pro' => ['name' => 'VEO 3.1 Pro', 'costs' => ['720p' => '¥1.00/次', '1080p' => '¥1.20/次', '4k' => '¥1.50/次'], 'offset' => 100],
        ];
        $modes = ['text_to_video', 'image_to_video', 'first_last_frame'];
        $ratios = ['16:9', '9:16'];

        foreach ($models as $modelId => $meta) {
            $resolutionIndex = 0;
            foreach ($meta['costs'] as $resolution => $costText) {
                foreach ($modes as $modeIndex => $mode) {
                    foreach ($ratios as $ratioIndex => $ratio) {
                        $legacy = $mode === 'text_to_video' && $ratio === '16:9';
                        $skuKey = $legacy ? 'duomi:' . $modelId . ':' . $resolution : $this->skuKey($modelId, $mode, 8, $resolution, $ratio);
                        $this->upsertSku($modelId, $skuKey, (string)$meta['name'] . ' ' . $this->modeLabel($mode) . ' 8秒 ' . $resolution . ' ' . $ratio, 'veo', $mode, 8, $resolution, $ratio, (string)$costText . '（多米 doc/98）', 'https://duomiapi.com/doc/98', 2000 + (int)$meta['offset'] + $resolutionIndex * 30 + $modeIndex * 10 + $ratioIndex);
                    }
                }
                $resolutionIndex++;
            }
        }
    }

    private function syncGrokSkus(): void
    {
        $ratios = ['2:3', '3:2', '1:1', '9:16', '16:9'];
        $durationCosts = [6 => '¥0.28/次', 10 => '¥0.28/次', 15 => '¥0.56/次', 20 => '¥0.56/次', 25 => '¥0.84/次', 30 => '¥0.84/次'];
        $durationIndex = 0;
        foreach ($durationCosts as $duration => $costText) {
            foreach ($ratios as $ratioIndex => $ratio) {
                $this->upsertSku('grok-video', $this->skuKey('grok-video', 'text_to_video', (int)$duration, '720p', $ratio), 'GROK Video 文生 ' . $duration . '秒 720p ' . $ratio, 'grok', 'text_to_video', (int)$duration, '720p', $ratio, $costText . '（参考成本，以多米控制台为准）', 'https://duomiapi.com/doc/98', 3000 + $durationIndex * 10 + $ratioIndex);
            }
            $durationIndex++;
        }
    }

    private function clearLegacyPlaceholderPrices(): void
    {
        $legacyPrices = [
            'duomi:doubao-seedance-2-0-260128:5s:standard' => 5.0,
            'duomi:doubao-seedance-2-0-260128:10s:standard' => 10.0,
            'duomi:doubao-seedance-2-0-fast-260128:5s:standard' => 5.0,
            'duomi:doubao-seedance-2-0-fast-260128:10s:standard' => 10.0,
            'duomi:veo3.1-fast:720p' => 0.2,
            'duomi:veo3.1-fast:1080p' => 0.4,
            'duomi:veo3.1-fast:4k' => 0.5,
            'duomi:veo3.1-pro:720p' => 1.0,
            'duomi:veo3.1-pro:1080p' => 1.2,
            'duomi:veo3.1-pro:4k' => 1.5,
            'duomi:grok-video:default' => 0.2,
        ];

        foreach ($legacyPrices as $skuKey => $price) {
            DB::table('video_sku_prices')
                ->where('sku_key', $skuKey)
                ->where('default_credit_cost', $price)
                ->update([
                    'default_credit_cost' => null,
                    'price_label' => '',
                    'updated_at' => now(),
                ]);
        }
    }

    private function upsertModel(string $modelId, string $protocol, string $displayName, string $generationType, array $modes, array $durations, array $resolutions, array $ratios, int $maxReferenceImages, string $description, int $sortOrder, string $docUrl, string $submitPath, string $queryPath): void
    {
        $now = now();
        $data = [
            'provider_key' => 'duomi',
            'provider_protocol' => $protocol,
            'model_id' => $modelId,
            'display_name' => $displayName,
            'generation_type' => $generationType,
            'status' => 'active',
            'supported_modes' => json_encode($modes, JSON_UNESCAPED_UNICODE),
            'supported_durations' => json_encode($durations, JSON_UNESCAPED_UNICODE),
            'supported_resolutions' => json_encode($resolutions, JSON_UNESCAPED_UNICODE),
            'supported_aspect_ratios' => json_encode($ratios, JSON_UNESCAPED_UNICODE),
            'max_reference_images' => $maxReferenceImages,
            'provider_params' => json_encode(['doc_url' => $docUrl, 'submit_path' => $submitPath, 'query_path' => $queryPath], JSON_UNESCAPED_UNICODE),
            'description' => $description,
            'sort_order' => $sortOrder,
            'updated_at' => $now,
        ];

        $exists = DB::table('video_model_specs')->where('provider_key', 'duomi')->where('model_id', $modelId)->exists();
        if ($exists) {
            DB::table('video_model_specs')->where('provider_key', 'duomi')->where('model_id', $modelId)->update($data);
            return;
        }

        $data['created_at'] = $now;
        DB::table('video_model_specs')->insert($data);
    }

    private function upsertSku(string $modelId, string $skuKey, string $title, string $protocol, string $mode, int $duration, string $resolution, string $ratio, string $costText, string $source, int $sortOrder): void
    {
        $modelSpecId = DB::table('video_model_specs')->where('provider_key', 'duomi')->where('model_id', $modelId)->value('id');
        if (!$modelSpecId) {
            return;
        }

        $now = now();
        $data = [
            'video_model_spec_id' => (int)$modelSpecId,
            'provider_key' => 'duomi',
            'provider_protocol' => $protocol,
            'model_id' => $modelId,
            'title' => $title,
            'mode' => $mode,
            'duration_seconds' => $duration,
            'resolution' => $resolution,
            'aspect_ratio' => $ratio,
            'quality' => '',
            'default_credit_cost' => null,
            'price_label' => '',
            'provider_cost_text' => $costText,
            'provider_cost_source' => $source,
            'provider_params' => json_encode([], JSON_UNESCAPED_UNICODE),
            'status' => 'active',
            'sort_order' => $sortOrder,
            'updated_at' => $now,
        ];

        $exists = DB::table('video_sku_prices')->where('sku_key', $skuKey)->exists();
        if ($exists) {
            unset($data['default_credit_cost'], $data['price_label']);
            DB::table('video_sku_prices')->where('sku_key', $skuKey)->update($data);
            return;
        }

        $data['sku_key'] = $skuKey;
        $data['created_at'] = $now;
        DB::table('video_sku_prices')->insert($data);
    }

    private function skuKey(string $modelId, string $mode, int $duration, string $resolution, string $ratio): string
    {
        return 'duomi:' . $modelId . ':' . $mode . ':' . $duration . 's:' . strtolower($resolution) . ':' . str_replace(':', 'x', $ratio);
    }

    private function modeLabel(string $mode): string
    {
        return match ($mode) {
            'text_to_video' => '文生',
            'image_to_video' => '图生',
            'first_last_frame' => '首尾帧',
            'standard' => '标准',
            'fast' => '快速',
            default => $mode,
        };
    }
};
