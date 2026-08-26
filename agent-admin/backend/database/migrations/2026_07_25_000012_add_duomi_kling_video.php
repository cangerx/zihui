<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * 新增多米「可灵 Kling」视频模型（官方格式-推荐）。
 *
 * 契约来源（2026-07-13 浏览器抓取多米文档 + Apifox）：
 *   - 提交：POST /api/video/kling/v1/videos/text2video（文生）/ .../image2video（图生）
 *     body：model_name / prompt / mode(std=720p·pro=1080p,必填) / sound(音画同步) / duration(3-15) /
 *           negative_prompt / cfg_scale(0-1) / image(图生首帧) / image_tail(首尾帧尾帧) / aspect_ratio(文生)
 *   - 查询：GET /api/video/kling/v1/videos/{text2video|image2video}/{task_id}
 *   - 响应：{code,message,data:{task_id, task_status(submitted/succeed/failed), task_result:{videos:[{url}]}}}
 *   - 鉴权：原始 Authorization 头（多米账号既有 raw 风格）
 *   适配器分支见 DuomiVideoProvider::buildKlingSubmitPayload / klingPath（provider_protocol='kling'）。
 *
 * 计费：default_credit_cost 为占位算力（≈元，取 doc/65 价格表「8折官方价、音画同步关闭」档），
 *       管理员到后台「AI 视频 → SKU 与价格」按实际策略调整。SKU 计费维度=清晰度(std/pro)×时长。
 *
 * 关键：不配 submit_path/query_path —— klingPath 按「文生/图生」自动分流命中不同 endpoint，
 *       若在 provider_params 写死 submit_path 会被 pathFor 覆盖、破坏文生/图生分流。
 *
 * 幂等：按 (provider_key, model_id) / sku_key 存在则跳过；仅 Schema:: / DB:: 原生 API，不 import 业务 Model。
 * 复用既有 provider_key=duomi 账号（同 base_url duomiapi.com / key / raw 鉴权），不新建服务商账号。
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('video_model_specs') || !Schema::hasTable('video_sku_prices')) {
            return;
        }
        $now = now();

        $modes = ['text_to_video', 'image_to_video', 'first_last_frame'];
        $ratios = ['16:9', '9:16', '1:1'];
        $durations = [5, 10];
        $resolutions = ['720p', '1080p']; // 720p→std / 1080p→pro（由适配器映射为 mode）

        // [model_id(=model_name), 展示名, 排序, 价格表 prices[dur][res]=占位算力(≈元)]
        $models = [
            ['kling-v1', '可灵 Kling v1', 60, [5 => ['720p' => 0.8, '1080p' => 2.8], 10 => ['720p' => 1.6, '1080p' => 5.6]]],
            ['kling-v2-5-turbo', '可灵 Kling v2.5 Turbo', 70, [5 => ['720p' => 1.2, '1080p' => 2.0], 10 => ['720p' => 2.4, '1080p' => 4.0]]],
            ['kling-v3', '可灵 Kling v3', 80, [5 => ['720p' => 2.4, '1080p' => 3.2], 10 => ['720p' => 4.8, '1080p' => 6.4]]],
        ];

        foreach ($models as [$modelId, $displayName, $sort, $prices]) {
            if (DB::table('video_model_specs')->where('provider_key', 'duomi')->where('model_id', $modelId)->exists()) {
                continue; // 幂等
            }

            DB::table('video_model_specs')->insert([
                'provider_key'            => 'duomi',
                'provider_protocol'       => 'kling',
                'model_id'                => $modelId,
                'display_name'            => $displayName,
                'generation_type'         => 'text_or_image_to_video',
                'status'                  => 'active',
                'supported_modes'         => json_encode($modes, JSON_UNESCAPED_UNICODE),
                'supported_durations'     => json_encode($durations),
                'supported_resolutions'   => json_encode($resolutions),
                'supported_aspect_ratios' => json_encode($ratios, JSON_UNESCAPED_UNICODE),
                'max_reference_images'    => 2, // 图生 1 图 / 首尾帧 2 图
                'provider_params'         => json_encode(['doc_url' => 'https://duomiapi.com/doc/65', 'sound' => 'off'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'description'             => '多米可灵 Kling 视频（官方格式，std=720p / pro=1080p，音画同步默认关闭）。',
                'sort_order'              => $sort,
                'created_at'              => $now,
                'updated_at'              => $now,
            ]);

            $specId = (int) DB::table('video_model_specs')
                ->where('provider_key', 'duomi')->where('model_id', $modelId)->value('id');
            if ($specId <= 0) {
                continue;
            }

            $rows = [];
            $order = 10;
            foreach ($durations as $dur) {
                foreach ($resolutions as $res) {
                    $skuKey = "duomi:{$modelId}:{$dur}s:{$res}";
                    if (DB::table('video_sku_prices')->where('sku_key', $skuKey)->exists()) {
                        continue;
                    }
                    $credits = (float) ($prices[$dur][$res] ?? 0);
                    $label = $res === '1080p' ? 'pro·1080p' : 'std·720p';
                    $rows[] = [
                        'video_model_spec_id'  => $specId,
                        'sku_key'              => $skuKey,
                        'provider_key'         => 'duomi',
                        'provider_protocol'    => 'kling',
                        'model_id'             => $modelId,
                        'title'                => "{$displayName} {$dur}s {$label}",
                        'mode'                 => '',
                        'duration_seconds'     => $dur,
                        'resolution'           => $res,
                        'aspect_ratio'         => '',
                        'quality'              => '',
                        'default_credit_cost'  => $credits,
                        'price_label'          => $credits > 0 ? rtrim(rtrim((string) $credits, '0'), '.') . ' 算力/次' : '后台配置',
                        'provider_cost_text'   => "多米 doc/65：约 ¥{$credits}/次（8折官方价，音画同步关闭）",
                        'provider_cost_source' => 'https://duomiapi.com/doc/65',
                        'provider_params'      => json_encode([], JSON_UNESCAPED_UNICODE),
                        'status'               => 'active',
                        'sort_order'           => $order,
                        'created_at'           => $now,
                        'updated_at'           => $now,
                    ];
                    $order += 10;
                }
            }
            if (!empty($rows)) {
                DB::table('video_sku_prices')->insert($rows);
            }
        }
    }

    public function down(): void
    {
        // 不在回滚中删除业务数据（管理员可能已改价 / 启用），避免误删线上配置。
    }
};
