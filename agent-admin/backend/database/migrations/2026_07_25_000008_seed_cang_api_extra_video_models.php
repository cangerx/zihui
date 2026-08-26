<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * 在 cang-api（https://ai.772.ee）下预置 happyhorse-1.0 与 seedance-2-vip 两个视频模型骨架。
 *
 * 实测背景（2026-06-21）：GET /v1/models 含 happyhorse-1.0 / seedance-2-vip（及 seedance-2 /
 *   seedance-2.0-n / grok-imagine-video-1.5-preview）。happyhorse-1.0 实测同一请求体完整出片；
 *   seedance-2-vip body 已被接受（仅测试余额不足未跑完），单价约标准 3 倍。
 *   （grok 是图生、契约与 seedance 不同，未实测，本次不预置；seedance-2 / -2.0-n 如需可后台手工加。）
 *
 * 安全约定：
 *   - 复用既有 cang-api 账号（同 base_url / key），不新建服务商账号；
 *   - SKU 一律 status=disabled、占位算力 —— 价格因实例而异，避免错误定价直接对外；
 *     管理员到后台「AI 视频 → SKU 与价格」定价后启用 SKU 即对终端用户可见。
 *
 * 幂等：按 (provider_key, model_id) 存在则整体跳过；仅 Schema:: / DB:: 原生 API，不 import 业务 Model。
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('video_model_specs') || !Schema::hasTable('video_sku_prices')) {
            return;
        }
        $now = now();

        $providerParams = [
            'submit_path'      => '/v1/videos',
            'query_path'       => '/v1/videos/{task_id}',
            'resolution_param' => 'resolution',
            'ref_media'        => ['image', 'video'],
        ];
        $ratios = ['16:9', '9:16', '1:1', '4:3', '3:4'];

        // [model_id, 展示名, 生成类型, 排序, 占位算力倍率]
        $models = [
            ['happyhorse-1.0', 'HappyHorse 1.0', 'text_or_image_to_video', 20, 1.0],
            ['seedance-2-vip', 'Seedance 2.0 VIP（真人满血）', 'text_or_image_to_video', 30, 3.0],
        ];

        // 占位算力基数（沿用既有 cang-api seedance）：[时长, 清晰度, 算力]
        $base = [
            [5, '720p', 5], [5, '1080p', 8],
            [10, '720p', 10], [10, '1080p', 16],
            [15, '720p', 15], [15, '1080p', 24],
        ];

        foreach ($models as [$modelId, $displayName, $genType, $sort, $mult]) {
            $exists = DB::table('video_model_specs')
                ->where('provider_key', 'cang-api')->where('model_id', $modelId)->exists();
            if ($exists) {
                continue; // 幂等：已预置（或管理员已手工加）则整体跳过
            }

            DB::table('video_model_specs')->insert([
                'provider_key'            => 'cang-api',
                'provider_protocol'       => 'openai_video',
                'model_id'                => $modelId,
                'display_name'            => $displayName,
                'generation_type'         => $genType,
                'status'                  => 'active',
                'supported_modes'         => json_encode(['text_to_video', 'image_to_video'], JSON_UNESCAPED_UNICODE),
                'supported_durations'     => json_encode([5, 10, 15]),
                'supported_resolutions'   => json_encode(['720p', '1080p']),
                'supported_aspect_ratios' => json_encode($ratios),
                'max_reference_images'    => 4,
                'provider_params'         => json_encode($providerParams, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'description'             => '',
                'sort_order'              => $sort,
                'created_at'              => $now,
                'updated_at'              => $now,
            ]);

            $specId = (int) DB::table('video_model_specs')
                ->where('provider_key', 'cang-api')->where('model_id', $modelId)->value('id');
            if ($specId <= 0) {
                continue;
            }

            $rows = [];
            $order = 10;
            foreach ($base as [$dur, $res, $credit]) {
                $skuKey = "cang-api:{$modelId}:{$dur}s:{$res}";
                if (DB::table('video_sku_prices')->where('sku_key', $skuKey)->exists()) {
                    continue;
                }
                $rows[] = [
                    'video_model_spec_id'  => $specId,
                    'sku_key'              => $skuKey,
                    'provider_key'         => 'cang-api',
                    'provider_protocol'    => 'openai_video',
                    'model_id'             => $modelId,
                    'title'                => "{$displayName} {$dur}s {$res}",
                    'mode'                 => '',
                    'duration_seconds'     => $dur,
                    'resolution'           => $res,
                    'aspect_ratio'         => '',
                    'quality'              => '',
                    'default_credit_cost'  => (int) round($credit * $mult),
                    'price_label'          => '',
                    'provider_cost_text'   => '',
                    'provider_cost_source' => '',
                    'provider_params'      => json_encode([], JSON_UNESCAPED_UNICODE),
                    'status'               => 'disabled', // 默认禁用：管理员定价后启用
                    'sort_order'           => $order,
                    'created_at'           => $now,
                    'updated_at'           => $now,
                ];
                $order += 10;
            }
            if (!empty($rows)) {
                DB::table('video_sku_prices')->insert($rows);
            }
        }
    }

    public function down(): void
    {
        // 预置骨架不在回滚中删除（管理员可能已定价/启用），避免误删线上配置。
    }
};
