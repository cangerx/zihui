<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * 全面修复 cang-api 视频服务商（https://ai.772.ee New API 中转）的 seedance 接入。
 *
 * 实测背景（2026-06-21 带真实 key 实测 /v1/models 与 /v1/videos）：
 *   - 中转合法模型为连字符 id（seedance-2.0 等），原始预置写死的 `seedance_2`(下划线) 不在
 *     模型列表 → 提交必失败，是头号 bug。
 *   - seedance-2.0 实测 720P / 1080P 均可完整出片；画面比例随 size=宽x高 传递有效；
 *     图生视频用顶层 media_urls 数组（适配器现有逻辑正确，文档的 typed input_reference
 *     在本中转被拒：cannot unmarshal array into ... type string）。
 *   故核心修复只需纠正 model_id + 放回被 000008 误禁的 1080p，无需改适配器代码。
 *
 * 两类实例并存，本 migration 同时安全覆盖：
 *   A. 原始 migration 状态（cang-api 只有 seedance_2，且无 seedance-2.0）：改名 + 修能力。
 *   B. 管理员已手工新增 seedance-2.0 的实例（线上即如此）：不改名（避免重复 model_id /
 *      撞 SKU 键），仅做「追加式」增量——给缺失的规格补 ref_media，开放视频参考；绝不动
 *      管理员已设的比例 / 清晰度 / 状态 / 价格。
 *
 * 幂等；仅 Schema:: / DB:: 原生 API，不 import 业务 Model。
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('video_model_specs')) {
            return;
        }
        $now = now();

        $hasFixed = DB::table('video_model_specs')
            ->where('provider_key', 'cang-api')
            ->where('model_id', 'seedance-2.0')
            ->exists();

        // ===== A. 原始状态实例：把非法的 seedance_2 改名为 seedance-2.0 并修能力 =====
        if (!$hasFixed) {
            $spec = DB::table('video_model_specs')
                ->where('provider_key', 'cang-api')
                ->where('model_id', 'seedance_2')
                ->first();

            if ($spec) {
                $params = json_decode($spec->provider_params ?? '{}', true);
                if (!is_array($params)) {
                    $params = [];
                }
                $params = array_merge($params, [
                    'submit_path'      => $params['submit_path'] ?? '/v1/videos',
                    'query_path'       => $params['query_path'] ?? '/v1/videos/{task_id}',
                    'resolution_param' => 'resolution',        // 顶层大写档位（实测必需）
                    'ref_media'        => ['image', 'video'],   // 图片+视频参考（音频需桌面端配合，本轮不做）
                ]);

                DB::table('video_model_specs')->where('id', $spec->id)->update([
                    'model_id'                => 'seedance-2.0',
                    'supported_resolutions'   => json_encode(['720p', '1080p']),
                    'supported_aspect_ratios' => json_encode(['16:9', '9:16', '1:1', '4:3', '3:4']),
                    'max_reference_images'    => 4,
                    'provider_params'         => json_encode($params, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                    'updated_at'              => $now,
                ]);

                // SKU 的 model_id 跟随纠正（适配器实发的是 sku->model_id）；sku_key 不动
                DB::table('video_sku_prices')
                    ->where('provider_key', 'cang-api')
                    ->where('model_id', 'seedance_2')
                    ->update(['model_id' => 'seedance-2.0', 'updated_at' => $now]);

                // 放回被 000008 误禁的 1080p SKU（实测 1080P 完整出片）
                DB::table('video_sku_prices')
                    ->where('provider_key', 'cang-api')
                    ->where('model_id', 'seedance-2.0')
                    ->where('resolution', '1080p')
                    ->where('status', 'disabled')
                    ->update(['status' => 'active', 'updated_at' => $now]);
            }
        }

        // ===== B. 通用追加式增量（所有实例，幂等）：给缺 ref_media 的 cang-api 规格补上 =====
        // 让管理员手工新增 / 已修复实例的 seedance 系模型也开放图片+视频参考；
        // 仅在缺失时追加，绝不覆盖管理员已设的其它字段（比例 / 清晰度 / 状态 / 价格不动）。
        $specs = DB::table('video_model_specs')->where('provider_key', 'cang-api')->get();
        foreach ($specs as $s) {
            $p = json_decode($s->provider_params ?? '{}', true);
            if (!is_array($p)) {
                $p = [];
            }
            if (array_key_exists('ref_media', $p)) {
                continue; // 已有（含上面 A 刚写入的）则跳过，保持幂等且不覆盖
            }
            $p['ref_media'] = ['image', 'video'];
            if (!array_key_exists('resolution_param', $p)) {
                $p['resolution_param'] = 'resolution';
            }
            DB::table('video_model_specs')->where('id', $s->id)->update([
                'provider_params' => json_encode($p, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'updated_at'      => $now,
            ]);
        }
    }

    public function down(): void
    {
        // 纠正性配置，回滚有害无益（缺 model_id 纠正会让 cang-api 视频重新报错），留空。
    }
};
