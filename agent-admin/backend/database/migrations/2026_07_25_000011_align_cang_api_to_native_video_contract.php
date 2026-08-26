<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * 对齐 cang-api（https://ai.772.ee）到「视频原生契约」（参考/视频接入文档.md）。
 *
 * 背景：接口方发布全新原生契约，模型枚举为 videos-standard / videos-fast / videos-mini，
 *   请求字段为 duration(整数) / ratio(16:9/9:16/1:1) / resolution(小写 720p/480p) /
 *   referenceImages[] / referenceVideos[] / referenceAudios[]；不再有 size / seconds /
 *   media_urls，也无 /cancel。旧的 New API 兼容模型（seedance-2.0 / videos / happyhorse-1.0 /
 *   seedance-2-vip 等）与旧字段方言在新契约下会 unsupported_request → 全量提交失败。
 *
 * 本迁移（配合 OpenAiVideoProvider 的 contract=cang_native 分支）：
 *   1) 预置三个原生模型 spec + SKU（active）。provider_params.contract=cang_native 触发适配器
 *      发原生字段；清晰度收敛 720p/480p、比例收敛 16:9/9:16/1:1、参考素材开放 image/video/audio、
 *      max_reference_images=9。default_credit_cost 为占位算力，管理员按实价调整。
 *   2) 全量切换：把旧 cang-api 模型 spec 与其 SKU 全部 disabled（不删除，遵守 Migration 铁律；
 *      如上游仍兼容旧契约需回滚，后台把旧 spec/SKU 状态改回 active 即可）。
 *
 * 幂等：按 (provider_key, model_id) / sku_key 判断已存在则跳过预置；旧模型 disable 为条件更新，
 *   可重复执行。仅 Schema:: / DB:: 原生 API，不 import 业务 Model。
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
            'submit_path' => '/v1/videos',
            'query_path'  => '/v1/videos/{task_id}',
            'contract'    => 'cang_native',              // 触发 OpenAiVideoProvider 原生契约分支
            'ref_media'   => ['image', 'video', 'audio'], // 放开图/视频/音频参考（SKU 层校验依据）
        ];
        $resolutions = ['720p', '480p'];
        $ratios = ['16:9', '9:16', '1:1'];
        $durations = [5, 10, 15];

        // [model_id, 展示名, 排序, 占位算力倍率]
        $newModels = [
            ['videos-standard', 'Videos Standard', 10, 1.4],
            ['videos-fast', 'Videos Fast', 20, 1.0],
            ['videos-mini', 'Videos Mini', 30, 0.6],
        ];
        // 占位算力基数：[时长, 清晰度, 基准算力]（480p 更省算力）
        $base = [
            [5, '720p', 5], [10, '720p', 10], [15, '720p', 15],
            [5, '480p', 3], [10, '480p', 6], [15, '480p', 9],
        ];

        foreach ($newModels as [$modelId, $displayName, $sort, $mult]) {
            // 幂等：已存在（或管理员已手工加）则整体跳过，不覆盖其配置
            if (DB::table('video_model_specs')->where('provider_key', 'cang-api')->where('model_id', $modelId)->exists()) {
                continue;
            }

            DB::table('video_model_specs')->insert([
                'provider_key'            => 'cang-api',
                'provider_protocol'       => 'openai_video',
                'model_id'                => $modelId,
                'display_name'            => $displayName,
                'generation_type'         => 'text_or_image_to_video',
                'status'                  => 'active',
                'supported_modes'         => json_encode(['text_to_video', 'image_to_video'], JSON_UNESCAPED_UNICODE),
                'supported_durations'     => json_encode($durations),
                'supported_resolutions'   => json_encode($resolutions),
                'supported_aspect_ratios' => json_encode($ratios),
                'max_reference_images'    => 9,
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
                    'default_credit_cost'  => max(1, (int) round($credit * $mult)),
                    'price_label'          => '',
                    'provider_cost_text'   => '',
                    'provider_cost_source' => '',
                    'provider_params'      => json_encode([], JSON_UNESCAPED_UNICODE),
                    'status'               => 'active',
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

        // ===== 全量切换：除三个原生模型外，旧 cang-api 模型与其 SKU 全部 disabled（不删除，可回滚）=====
        $nativeModelIds = ['videos-standard', 'videos-fast', 'videos-mini'];
        DB::table('video_model_specs')
            ->where('provider_key', 'cang-api')
            ->whereNotIn('model_id', $nativeModelIds)
            ->where('status', '!=', 'disabled')
            ->update(['status' => 'disabled', 'updated_at' => $now]);
        DB::table('video_sku_prices')
            ->where('provider_key', 'cang-api')
            ->whereNotIn('model_id', $nativeModelIds)
            ->where('status', '!=', 'disabled')
            ->update(['status' => 'disabled', 'updated_at' => $now]);
    }

    public function down(): void
    {
        // 对齐性配置，回滚有害无益（会让 cang-api 视频重新用旧契约字段报错），留空。
        // 如需回退到旧模型，请在后台把旧 spec/SKU 状态手动改回 active。
    }
};
