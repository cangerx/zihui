<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * 预置「cang-api」OpenAI 兼容视频服务商模板（New API 中转）。
 *
 * 目的：让所有部署的云控端升级后自动获得这个服务商框架，管理员只需到
 *       后台「AI 视频 → 服务商账号」填自己的 API Key 并启用即可对接，
 *       无需手填 Base URL / 驱动 / 协议路径等一堆参数。
 *
 * 安全约定（务必遵守）：
 *   - api_key 一律留空，绝不随代码内置（key 是单账户敏感凭据，内置会泄露 + 全员共用额度）
 *   - status=disabled；且空 key 时 catalog 本就不展示，双重避免误暴露给终端用户
 *
 * 幂等：已存在 provider_key=cang-api 的部署（例如已手动配置过）整体跳过，
 *       不覆盖其已填写的 key / 状态 / 价格。
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('video_provider_accounts')) {
            return;
        }
        // 已配置则保护现状，整体跳过（不覆盖管理员已填的 key）
        if (DB::table('video_provider_accounts')->where('provider_key', 'cang-api')->exists()) {
            return;
        }

        $now = now();

        DB::table('video_provider_accounts')->insert([
            'provider_key' => 'cang-api',
            'name' => 'cang-api',
            'base_url' => 'https://ai.772.ee',
            'api_key' => null,
            'auth_style' => 'bearer',
            'status' => 'disabled',
            'config' => json_encode(['driver' => 'openai_video', 'verify_ssl' => true], JSON_UNESCAPED_UNICODE),
            'last_test_message' => '',
            'remark' => 'OpenAI 兼容视频中转（New API）。填写 API Key 后启用即可使用。',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        if (!DB::table('video_model_specs')->where('provider_key', 'cang-api')->where('model_id', 'seedance_2')->exists()) {
            DB::table('video_model_specs')->insert([
                'provider_key' => 'cang-api',
                'provider_protocol' => 'openai_video',
                'model_id' => 'seedance_2',
                'display_name' => 'Seedance 2.0',
                'generation_type' => 'text_or_image_to_video',
                'status' => 'active',
                'supported_modes' => json_encode(['text_to_video', 'image_to_video'], JSON_UNESCAPED_UNICODE),
                'supported_durations' => json_encode([5, 10], JSON_UNESCAPED_UNICODE),
                'supported_resolutions' => json_encode(['720p', '1080p'], JSON_UNESCAPED_UNICODE),
                'supported_aspect_ratios' => json_encode(['16:9', '9:16', '1:1'], JSON_UNESCAPED_UNICODE),
                'max_reference_images' => 1,
                'provider_params' => json_encode([
                    'submit_path' => '/v1/videos',
                    'query_path' => '/v1/videos/{task_id}',
                    'cancel_path' => '/v1/videos/{task_id}/cancel',
                ], JSON_UNESCAPED_UNICODE),
                'description' => '',
                'sort_order' => 10,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        $specId = (int) DB::table('video_model_specs')
            ->where('provider_key', 'cang-api')
            ->where('model_id', 'seedance_2')
            ->value('id');

        if ($specId > 0 && DB::table('video_sku_prices')->where('provider_key', 'cang-api')->count() === 0) {
            $rows = [];
            // [sku_key, 标题, 时长秒, 清晰度, 默认算力(占位，管理员可改), 排序]
            $skus = [
                ['cang-api:seedance_2:5s:720p', 'Seedance 2.0 5s 720p', 5, '720p', 5, 10],
                ['cang-api:seedance_2:5s:1080p', 'Seedance 2.0 5s 1080p', 5, '1080p', 8, 20],
                ['cang-api:seedance_2:10s:720p', 'Seedance 2.0 10s 720p', 10, '720p', 10, 30],
                ['cang-api:seedance_2:10s:1080p', 'Seedance 2.0 10s 1080p', 10, '1080p', 16, 40],
            ];
            foreach ($skus as [$skuKey, $title, $duration, $resolution, $credits, $sort]) {
                $rows[] = [
                    'video_model_spec_id' => $specId,
                    'sku_key' => $skuKey,
                    'provider_key' => 'cang-api',
                    'provider_protocol' => 'openai_video',
                    'model_id' => 'seedance_2',
                    'title' => $title,
                    'mode' => '',
                    'duration_seconds' => $duration,
                    'resolution' => $resolution,
                    'aspect_ratio' => '',
                    'quality' => '',
                    'default_credit_cost' => $credits,
                    'price_label' => '',
                    'provider_cost_text' => '',
                    'provider_cost_source' => '',
                    'provider_params' => json_encode([], JSON_UNESCAPED_UNICODE),
                    'status' => 'active',
                    'sort_order' => $sort,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
            DB::table('video_sku_prices')->insert($rows);
        }
    }

    public function down(): void
    {
        // 预置模板不在回滚中删除业务数据：管理员可能已填写 key / 改价 / 启用，
        // 误删会破坏线上配置。如需移除请在后台手动操作。
    }
};
