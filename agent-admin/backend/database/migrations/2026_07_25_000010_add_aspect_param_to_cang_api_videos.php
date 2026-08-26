<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * 修复：cang-api（New API 中转 → 字节）下 model_id=videos（OpenAI Sora 兼容路径）
 *       视频生成报「ratio 错误，当前模型仅支持 ... 当前: 1920x1080」。
 *
 * 背景（2026-06-22 带真实 key 实测 https://ai.772.ee/v1/videos）：
 *   - 该站点当前唯一启用的视频模型是管理员手工新增的 `videos`，其 provider_params
 *     只有 submit_path/query_path，缺 aspect_param。
 *   - 适配器 OpenAiVideoProvider 只在配置了 aspect_param 时才发顶层画面比例字段；
 *     未配置 → 只发 size=宽x高（如 1920x1080）。而 `videos` 模型要求用 ratio（比例
 *     枚举 16:9/9:16/1:1/21:9/3:4/4:3）指定画面比例，于是把 size 的值当 ratio 校验
 *     → 报错。（注意：同族 seedance-2.0 能从 size 推比例，videos 不能，契约不同。）
 *   - 实测：补发 ratio（与 size 同时存在）后，720p / 1080p / 15s 创建均返回 200。
 *     videos 靠 size 携带分辨率，无需单独 resolution 字段，故本迁移只补 aspect_param，
 *     不动 resolution_param（多发反而可能冲突）。
 *
 * 配合代码：OpenAiVideoProvider::buildSubmitPayload 已支持 provider_params.aspect_param
 *       —— 指定字段名后，把 request_params.aspect_ratio（如 16:9）以该顶层字段发出。
 *
 * 幂等：已配置 aspect_param=ratio 的 videos 规格跳过，可重复执行。
 *       仅作用于 model_id=videos，不触碰 seedance 系（其用 size 即可、无需 ratio）。
 *       仅 Schema:: / DB:: 原生 API，不 import 业务 Model。
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('video_model_specs')) {
            return;
        }

        $now = now();
        $specs = DB::table('video_model_specs')
            ->where('provider_key', 'cang-api')
            ->where('model_id', 'videos')
            ->get();

        foreach ($specs as $spec) {
            $params = json_decode($spec->provider_params ?? '{}', true);
            if (!is_array($params)) {
                $params = [];
            }
            // 已配置则幂等跳过，不覆盖管理员可能已自定义的其它字段
            if (($params['aspect_param'] ?? null) === 'ratio') {
                continue;
            }
            $params['aspect_param'] = 'ratio';
            DB::table('video_model_specs')
                ->where('id', $spec->id)
                ->update([
                    'provider_params' => json_encode($params, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                    'updated_at' => $now,
                ]);
        }
    }

    public function down(): void
    {
        // 纠正性配置，回滚有害无益（移除 aspect_param 会让 videos 视频重新报 ratio 错误），留空。
    }
};
