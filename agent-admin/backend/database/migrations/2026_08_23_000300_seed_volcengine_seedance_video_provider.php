<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * 预置火山方舟官方 Seedance 线路。api_key 留空、账号默认禁用。
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('video_provider_accounts')) {
            return;
        }

        $now = now();

        if (!DB::table('video_provider_accounts')->where('provider_key', 'volcengine')->exists()) {
            DB::table('video_provider_accounts')->insert([
                'provider_key' => 'volcengine',
                'name' => '火山方舟 Seedance',
                'base_url' => 'https://ark.cn-beijing.volces.com',
                'api_key' => null,
                'auth_style' => 'bearer',
                'status' => 'disabled',
                'config' => json_encode(['driver' => 'volcengine_ark', 'verify_ssl' => true], JSON_UNESCAPED_UNICODE),
                'last_test_message' => '',
                'remark' => '官方视频生成 API。填写方舟 API Key 后启用。文档：https://www.volcengine.com/docs/82379/1520757',
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        if (!Schema::hasTable('video_model_specs')) {
            return;
        }

        $models = [
            [
                'model_id' => 'doubao-seedance-2-0-260128',
                'display_name' => 'Seedance 2.0',
                'durations' => [5, 10, 15],
                'resolutions' => ['720p', '1080p'],
                'ratios' => ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
                'max_ref' => 9,
                'sort' => 20,
                'desc' => '火山方舟官方 Seedance 2.0。文生/图生/首尾帧/多模态参考。',
                'sku_durations' => [5, 10, 15],
                'sku_resolutions' => ['720p', '1080p'],
            ],
            [
                'model_id' => 'doubao-seedance-2-0-fast-260128',
                'display_name' => 'Seedance 2.0 Fast',
                'durations' => [5, 10, 15],
                'resolutions' => ['720p', '1080p'],
                'ratios' => ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
                'max_ref' => 9,
                'sort' => 21,
                'desc' => '火山方舟官方 Seedance 2.0 Fast。',
                'sku_durations' => [5, 10],
                'sku_resolutions' => ['720p', '1080p'],
            ],
            [
                'model_id' => 'doubao-seedance-2-5',
                'display_name' => 'Seedance 2.5',
                'durations' => [4, 5, 6, 8, 10, 12, 15, 20, 25, 30],
                'resolutions' => ['480p', '720p'],
                'ratios' => ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
                'max_ref' => 30,
                'sort' => 22,
                'desc' => '火山方舟官方 Seedance 2.5。时长 4–30 秒，清晰度仅 480p/720p。控制台 Endpoint ID 可改模型 ID。',
                'sku_durations' => [5, 10, 15, 20, 30],
                'sku_resolutions' => ['480p', '720p'],
            ],
        ];

        foreach ($models as $model) {
            if (!DB::table('video_model_specs')->where('provider_key', 'volcengine')->where('model_id', $model['model_id'])->exists()) {
                DB::table('video_model_specs')->insert([
                    'provider_key' => 'volcengine',
                    'provider_protocol' => 'volcengine_ark',
                    'model_id' => $model['model_id'],
                    'display_name' => $model['display_name'],
                    'generation_type' => 'multimodal_video',
                    'status' => 'active',
                    'supported_modes' => json_encode(['text_to_video', 'image_to_video', 'first_last_frame'], JSON_UNESCAPED_UNICODE),
                    'supported_durations' => json_encode($model['durations'], JSON_UNESCAPED_UNICODE),
                    'supported_resolutions' => json_encode($model['resolutions'], JSON_UNESCAPED_UNICODE),
                    'supported_aspect_ratios' => json_encode($model['ratios'], JSON_UNESCAPED_UNICODE),
                    'max_reference_images' => $model['max_ref'],
                    'provider_params' => json_encode([
                        'submit_path' => '/api/v3/contents/generations/tasks',
                        'query_path' => '/api/v3/contents/generations/tasks/{task_id}',
                        'ref_media' => ['image', 'video', 'audio'],
                    ], JSON_UNESCAPED_UNICODE),
                    'description' => $model['desc'],
                    'sort_order' => $model['sort'],
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        }

        if (!Schema::hasTable('video_sku_prices')) {
            return;
        }
        if (DB::table('video_sku_prices')->where('provider_key', 'volcengine')->exists()) {
            return;
        }

        $rows = [];
        $sort = 10;
        foreach ($models as $model) {
            $specId = (int) DB::table('video_model_specs')
                ->where('provider_key', 'volcengine')
                ->where('model_id', $model['model_id'])
                ->value('id');
            if ($specId <= 0) {
                continue;
            }
            foreach ($model['sku_durations'] as $duration) {
                foreach ($model['sku_resolutions'] as $resolution) {
                    $rows[] = [
                        'video_model_spec_id' => $specId,
                        'sku_key' => 'volcengine:' . $model['model_id'] . ':' . $duration . 's:' . $resolution,
                        'provider_key' => 'volcengine',
                        'provider_protocol' => 'volcengine_ark',
                        'model_id' => $model['model_id'],
                        'title' => $model['display_name'] . ' ' . $duration . 's ' . $resolution,
                        'mode' => '',
                        'duration_seconds' => $duration,
                        'resolution' => $resolution,
                        'aspect_ratio' => '',
                        'quality' => '',
                        'default_credit_cost' => null,
                        'price_label' => '',
                        'provider_cost_text' => '按方舟 Token 计费，后台自行定价',
                        'provider_cost_source' => 'https://www.volcengine.com/docs/82379/1544106',
                        'provider_params' => json_encode([], JSON_UNESCAPED_UNICODE),
                        'status' => 'active',
                        'sort_order' => $sort,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ];
                    $sort += 10;
                }
            }
        }
        if ($rows !== []) {
            DB::table('video_sku_prices')->insert($rows);
        }
    }

    public function down(): void
    {
        // 预置模板不回滚删除，避免清掉已填 Key / 改价。
    }
};
