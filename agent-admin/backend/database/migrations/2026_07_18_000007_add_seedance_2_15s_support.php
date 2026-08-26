<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * 补丁：为 cang-api 的 Seedance 2.0（seedance_2）补充 15 秒时长支持。
 *
 * 背景：预置 migration 000006 当初只配了 5s / 10s，但 Seedance 2.0 实际支持 15s。
 *       已发布 migration 不可修改（铁律），故用本增量补丁：
 *         1. 把 video_model_specs.supported_durations 并入 15（去重、保序）
 *         2. 新增 15s × 720p / 1080p 两个 SKU（占位价，管理员可改）
 *
 * 幂等：时长已含 15 则不重复写；SKU 已存在（按 sku_key）则跳过。
 *       仅针对 provider_key=cang-api / model_id=seedance_2，不影响其它服务商。
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('video_model_specs')) {
            return;
        }

        $spec = DB::table('video_model_specs')
            ->where('provider_key', 'cang-api')
            ->where('model_id', 'seedance_2')
            ->first();
        if (!$spec) {
            return;
        }

        $now = now();

        // 1. supported_durations 并入 15（整数、去重、升序）
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

        // 2. 新增 15s SKU（幂等）。[sku_key, 标题, 时长秒, 清晰度, 默认算力(占位), 排序]
        $skus = [
            ['cang-api:seedance_2:15s:720p', 'Seedance 2.0 15s 720p', 15, '720p', 15, 50],
            ['cang-api:seedance_2:15s:1080p', 'Seedance 2.0 15s 1080p', 15, '1080p', 24, 60],
        ];
        foreach ($skus as [$skuKey, $title, $duration, $resolution, $credits, $sort]) {
            if (DB::table('video_sku_prices')->where('sku_key', $skuKey)->exists()) {
                continue;
            }
            DB::table('video_sku_prices')->insert([
                'video_model_spec_id' => (int) $spec->id,
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
            ]);
        }
    }

    public function down(): void
    {
        // 不在回滚中删除业务数据（管理员可能已改价 / 启用），避免误删线上配置。
    }
};
