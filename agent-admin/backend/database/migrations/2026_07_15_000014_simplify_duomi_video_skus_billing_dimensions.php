<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * L2 简化：多米视频 SKU 只保留「计费维度」，比例(及 Seedance 分辨率)改为生成时由用户在模型能力内自选。
 *
 * - 对齐 video_model_specs.supported_* 与官方文档（火山 Seedance / 多米 VEO·GROK）
 * - 删除旧的笛卡尔积 SKU，按计费维度重建：
 *   Seedance 按秒（5/10s）、VEO 按分辨率（720p/1080p/4k，固定8s）、GROK 按时长（6 档，固定720p）
 * - SKU 中「未锁定」的维度（比例、Seedance 分辨率）留空，提交时按模型 supported_* 校验
 * - credit 价格沿用既有口径（无 pricing rule 时 VideoBillingContextService 回落 sku.default_credit_cost）
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('video_sku_prices') || !Schema::hasTable('video_model_specs')) {
            return;
        }

        DB::transaction(function () {
            $now = now();

            $this->alignSpec('doubao-seedance-2-0-260128', ['standard'], [5, 10], ['480p', '720p', '1080p'], ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'], 4, $now);
            $this->alignSpec('doubao-seedance-2-0-fast-260128', ['fast'], [5, 10], ['480p', '720p'], ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'], 4, $now);
            $this->alignSpec('veo3.1-fast', ['text_to_video', 'image_to_video', 'first_last_frame'], [8], ['720p', '1080p', '4k'], ['16:9', '9:16'], 3, $now);
            $this->alignSpec('veo3.1-pro', ['text_to_video', 'image_to_video', 'first_last_frame'], [8], ['720p', '1080p', '4k'], ['16:9', '9:16'], 3, $now);
            $this->alignSpec('grok-video', ['text_to_video', 'image_to_video'], [6, 10, 15, 20, 25, 30], ['720p'], ['2:3', '3:2', '1:1', '9:16', '16:9'], 3, $now);

            $this->purgeDuomiSkus();

            $specs = DB::table('video_model_specs')->where('provider_key', 'duomi')->pluck('id', 'model_id');
            $rows = [];
            $sort = 0;
            $add = function (string $modelId, string $protocol, string $skuKey, array $locked, float $credit, string $title, string $costText) use (&$rows, &$sort, $specs, $now) {
                if (!isset($specs[$modelId])) {
                    return;
                }
                $rows[] = [
                    'video_model_spec_id' => (int) $specs[$modelId],
                    'sku_key' => $skuKey,
                    'provider_key' => 'duomi',
                    'provider_protocol' => $protocol,
                    'model_id' => $modelId,
                    'title' => $title,
                    'mode' => (string) ($locked['mode'] ?? ''),
                    'duration_seconds' => (int) ($locked['duration'] ?? 0),
                    'resolution' => (string) ($locked['resolution'] ?? ''),
                    'aspect_ratio' => '',
                    'quality' => '',
                    'default_credit_cost' => $credit,
                    'price_label' => rtrim(rtrim((string) $credit, '0'), '.') . ' 积分/次',
                    'provider_cost_text' => $costText,
                    'provider_cost_source' => 'https://duomiapi.com/doc/105',
                    'provider_params' => json_encode([], JSON_UNESCAPED_UNICODE),
                    'status' => 'active',
                    'sort_order' => $sort += 10,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            };

            // Seedance：按秒计费（1 元/秒），分辨率与比例生成时自选
            foreach ([5, 10] as $d) {
                $add('doubao-seedance-2-0-260128', 'seedance', "duomi:doubao-seedance-2-0-260128:{$d}s", ['mode' => 'standard', 'duration' => $d], (float) $d, "Seedance 2.0 · {$d} 秒", '多米 doc/105：1 元/秒（分辨率/比例不影响价格）');
            }
            foreach ([5, 10] as $d) {
                $add('doubao-seedance-2-0-fast-260128', 'seedance', "duomi:doubao-seedance-2-0-fast-260128:{$d}s", ['mode' => 'fast', 'duration' => $d], (float) $d, "Seedance 2.0 Fast · {$d} 秒", '多米 doc/105：1 元/秒（分辨率/比例不影响价格）');
            }
            // VEO：按分辨率计费，时长固定 8 秒，比例生成时自选
            foreach (['veo3.1-fast' => ['720p' => 0.2, '1080p' => 0.4, '4k' => 0.5], 'veo3.1-pro' => ['720p' => 1.0, '1080p' => 1.2, '4k' => 1.5]] as $modelId => $prices) {
                foreach ($prices as $res => $credit) {
                    $add($modelId, 'veo', "duomi:{$modelId}:{$res}", ['duration' => 8, 'resolution' => $res], (float) $credit, strtoupper($modelId) . " · {$res}", "多米 doc/98：{$modelId} {$res} {$credit} 元/次");
                }
            }
            // GROK：按时长计费，固定 720p，比例生成时自选
            foreach ([6 => 0.26, 10 => 0.28, 15 => 0.56, 20 => 0.56, 25 => 0.64, 30 => 0.64] as $d => $credit) {
                $add('grok-video', 'grok', "duomi:grok-video:{$d}s", ['duration' => $d, 'resolution' => '720p'], (float) $credit, "GROK Video · {$d} 秒", "多米 Apifox：GROK {$d}s {$credit} 元/次");
            }

            if (!empty($rows)) {
                DB::table('video_sku_prices')->insert($rows);
            }
        });
    }

    public function down(): void
    {
        // 结构性重建，不回滚（历史笛卡尔积 SKU 不还原）。
    }

    private function alignSpec(string $modelId, array $modes, array $durations, array $resolutions, array $ratios, int $maxRef, $now): void
    {
        DB::table('video_model_specs')
            ->where('provider_key', 'duomi')
            ->where('model_id', $modelId)
            ->update([
                'supported_modes' => json_encode($modes, JSON_UNESCAPED_UNICODE),
                'supported_durations' => json_encode($durations, JSON_UNESCAPED_UNICODE),
                'supported_resolutions' => json_encode($resolutions, JSON_UNESCAPED_UNICODE),
                'supported_aspect_ratios' => json_encode($ratios, JSON_UNESCAPED_UNICODE),
                'max_reference_images' => $maxRef,
                'updated_at' => $now,
            ]);
    }

    private function purgeDuomiSkus(): void
    {
        $ids = DB::table('video_sku_prices')->where('provider_key', 'duomi')->pluck('id')->map(fn($id) => (int) $id)->all();
        if (empty($ids)) {
            return;
        }
        if (Schema::hasTable('video_tasks')) {
            DB::table('video_tasks')->whereIn('video_sku_price_id', $ids)->update(['video_sku_price_id' => null]);
        }
        if (Schema::hasTable('video_usage_records')) {
            DB::table('video_usage_records')->whereIn('video_sku_price_id', $ids)->update(['video_sku_price_id' => null]);
        }
        if (Schema::hasTable('video_pricing_rules')) {
            DB::table('video_pricing_rules')->whereIn('video_sku_price_id', $ids)->delete();
        }
        DB::table('video_sku_prices')->whereIn('id', $ids)->delete();
    }
};
