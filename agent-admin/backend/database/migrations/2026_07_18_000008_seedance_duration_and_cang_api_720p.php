<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * 视频能力默认值调整：
 *   1. 多米 Seedance 2.0（标准 + Fast）补充 15s 时长，并新增 15s SKU（沿用现有 mode 锁定、清晰度/比例自选、100 算力/秒的规律）。
 *   2. cang-api 的 seedance_2 改为「只支持 720p」，画面比例对齐多米 Seedance（7 项），并禁用其 1080p SKU。
 *
 * 已发布 migration 不可改（铁律），故用本增量补丁；幂等，可重复执行。
 * 全部仅 Schema:: / DB:: 原生 API，不 import 业务 Model。
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('video_model_specs')) {
            return;
        }
        $now = now();

        // ===== 1. 多米 Seedance 2.0（标准 + Fast）补充 15s =====
        $duomiSeedance = DB::table('video_model_specs')
            ->where('provider_key', 'duomi')
            ->where('provider_protocol', 'seedance')
            ->get();

        foreach ($duomiSeedance as $spec) {
            // 1.1 supported_durations 并入 15（整数、去重、升序）
            $durations = json_decode($spec->supported_durations ?? '[]', true);
            if (!is_array($durations)) {
                $durations = [];
            }
            $durations = array_map('intval', $durations);
            if (!in_array(15, $durations, true)) {
                $durations[] = 15;
                $durations = array_values(array_unique($durations));
                sort($durations);
                DB::table('video_model_specs')->where('id', $spec->id)->update([
                    'supported_durations' => json_encode($durations),
                    'updated_at' => $now,
                ]);
            }

            // 1.2 新增 15s SKU（幂等）。沿用同模型现有 SKU 的 mode；价格按 100 算力/秒 → 1500
            $skuKey = 'duomi:' . $spec->model_id . ':15s';
            if (!DB::table('video_sku_prices')->where('sku_key', $skuKey)->exists()) {
                $sample = DB::table('video_sku_prices')
                    ->where('video_model_spec_id', $spec->id)
                    ->orderBy('duration_seconds')
                    ->first();
                DB::table('video_sku_prices')->insert([
                    'video_model_spec_id' => (int) $spec->id,
                    'sku_key' => $skuKey,
                    'provider_key' => 'duomi',
                    'provider_protocol' => 'seedance',
                    'model_id' => $spec->model_id,
                    'title' => $spec->display_name . ' 15 秒',
                    'mode' => (string) ($sample->mode ?? ''),
                    'duration_seconds' => 15,
                    'resolution' => '',
                    'aspect_ratio' => '',
                    'quality' => '',
                    'default_credit_cost' => 1500,
                    'price_label' => '',
                    'provider_cost_text' => (string) ($sample->provider_cost_text ?? ''),
                    'provider_cost_source' => (string) ($sample->provider_cost_source ?? ''),
                    'provider_params' => json_encode([], JSON_UNESCAPED_UNICODE),
                    'status' => 'active',
                    'sort_order' => 30,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        }

        // ===== 2. cang-api seedance_2：只支持 720p，比例对齐多米 Seedance =====
        $cang = DB::table('video_model_specs')
            ->where('provider_key', 'cang-api')
            ->where('model_id', 'seedance_2')
            ->first();

        if ($cang) {
            DB::table('video_model_specs')->where('id', $cang->id)->update([
                'supported_resolutions' => json_encode(['720p']),
                'supported_aspect_ratios' => json_encode(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive']),
                'updated_at' => $now,
            ]);

            // 禁用非 720p 的 SKU（如 1080p）；空清晰度的不动
            DB::table('video_sku_prices')
                ->where('provider_key', 'cang-api')
                ->where('model_id', 'seedance_2')
                ->where('resolution', '<>', '')
                ->where('resolution', '<>', '720p')
                ->update(['status' => 'disabled', 'updated_at' => $now]);
        }
    }

    public function down(): void
    {
        // 不在回滚中还原业务数据（管理员可能已改价 / 调整能力），避免误改线上配置。
    }
};
