<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * 预置 MiniMax H3 视频线路。api_key 留空、账号默认禁用。
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            return;
        }
        if (!Schema::hasTable('video_provider_accounts')) {
            return;
        }

        $now = now();

        if (!DB::table('video_provider_accounts')->where('provider_key', 'minimax')->exists()) {
            DB::table('video_provider_accounts')->insert([
                'provider_key' => 'minimax',
                'name' => 'MiniMax H3',
                'base_url' => 'https://api.minimaxi.com',
                'api_key' => null,
                'auth_style' => 'bearer',
                'status' => 'disabled',
                'config' => json_encode(['driver' => 'minimax_h3', 'verify_ssl' => true], JSON_UNESCAPED_UNICODE),
                'last_test_message' => '',
                'remark' => 'MiniMax H3 V2。填写接口密钥后启用。文档：https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create',
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        if (!Schema::hasTable('video_model_specs')) {
            return;
        }

        if (!DB::table('video_model_specs')->where('provider_key', 'minimax')->where('model_id', 'MiniMax-H3')->exists()) {
            DB::table('video_model_specs')->insert([
                'provider_key' => 'minimax',
                'provider_protocol' => 'minimax_h3',
                'model_id' => 'MiniMax-H3',
                'display_name' => 'MiniMax H3',
                'generation_type' => 'multimodal_video',
                'status' => 'active',
                'supported_modes' => json_encode(['text_to_video', 'image_to_video', 'first_last_frame'], JSON_UNESCAPED_UNICODE),
                'supported_durations' => json_encode([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], JSON_UNESCAPED_UNICODE),
                'supported_resolutions' => json_encode(['768P', '2K'], JSON_UNESCAPED_UNICODE),
                'supported_aspect_ratios' => json_encode(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], JSON_UNESCAPED_UNICODE),
                'max_reference_images' => 2,
                'provider_params' => json_encode([
                    'submit_path' => '/v2/video_generation',
                    'query_path' => '/v2/query/video_generation/{task_id}',
                    'ref_media' => ['image', 'video', 'audio'],
                ], JSON_UNESCAPED_UNICODE),
                'description' => 'MiniMax H3 多模态视频。文生须指定比例；图生比例由输入图自适应。',
                'sort_order' => 15,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        $specId = (int) DB::table('video_model_specs')
            ->where('provider_key', 'minimax')
            ->where('model_id', 'MiniMax-H3')
            ->value('id');

        if ($specId <= 0 || !Schema::hasTable('video_sku_prices')) {
            return;
        }
        if (DB::table('video_sku_prices')->where('provider_key', 'minimax')->exists()) {
            return;
        }

        $rows = [];
        $sort = 10;
        foreach ([5, 6, 10, 15] as $duration) {
            foreach (['768P', '2K'] as $resolution) {
                $rows[] = [
                    'video_model_spec_id' => $specId,
                    'sku_key' => 'minimax:MiniMax-H3:' . $duration . 's:' . $resolution,
                    'provider_key' => 'minimax',
                    'provider_protocol' => 'minimax_h3',
                    'model_id' => 'MiniMax-H3',
                    'title' => 'MiniMax H3 ' . $duration . 's ' . $resolution,
                    'mode' => '',
                    'duration_seconds' => $duration,
                    'resolution' => $resolution,
                    'aspect_ratio' => '',
                    'quality' => '',
                    'default_credit_cost' => null,
                    'price_label' => '',
                    'provider_cost_text' => '按量/企业 Token，后台自行定价',
                    'provider_cost_source' => 'https://platform.minimaxi.com/subscribe/token-plan?tab=api-enterprise',
                    'provider_params' => json_encode([], JSON_UNESCAPED_UNICODE),
                    'status' => 'active',
                    'sort_order' => $sort,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
                $sort += 10;
            }
        }
        DB::table('video_sku_prices')->insert($rows);
    }

    public function down(): void
    {
        // 预置模板不回滚删除，避免清掉已填 Key / 改价。
    }
};
