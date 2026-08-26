<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * 修复：cang-api（New API 中转 → 字节 seedance）视频生成因分辨率参数报错。
 *
 * 背景：接口方升级后，cang-api 的 seedance 渠道要求请求显式携带分辨率档位
 *       （顶层 resolution 字段，大写 720P / 1080P）。原 OpenAiVideoProvider 只发
 *       OpenAI 标准的 size=宽x高，中转无法反推，上游异步执行时报
 *       "Input should be '1080P' or '720P': parameters.resolution"。
 *
 * 配合代码：OpenAiVideoProvider 已支持 provider_params.resolution_param —— 指定
 *       字段名后，把内部小写档位（720p）转成大写（720P）以顶层字段发出。本 migration
 *       给所有 cang-api 的模型规格补上该配置，使各独立部署站点在线更新后自动生效。
 *
 * 幂等：已配置 resolution_param=resolution 的规格跳过，可重复执行。
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
            ->get();

        foreach ($specs as $spec) {
            $params = json_decode($spec->provider_params ?? '{}', true);
            if (!is_array($params)) {
                $params = [];
            }
            // 已配置则幂等跳过，不覆盖管理员可能已自定义的其它字段
            if (($params['resolution_param'] ?? null) === 'resolution') {
                continue;
            }
            $params['resolution_param'] = 'resolution';
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
        // 不在回滚中移除该配置：缺少它会让 cang-api 视频生成重新报错，
        // 属于修复性配置，回滚价值低且有害，故留空。
    }
};
