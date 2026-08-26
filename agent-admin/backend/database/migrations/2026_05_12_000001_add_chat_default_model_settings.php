<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up()
    {
        $now = now();
        $rows = [
            // 桌面端「对话页面默认模型」：新建会话时填入 conversation.active_model_*
            // 默认空：让桌面端在缺省时回退到本地第一个 chat 类型模型
            // - chat_default_model_provider: 通常为 'cloud:default'（云端虚拟服务商）；管理员也可以填本地 provider id（不推荐）
            // - chat_default_model_id: cloud_models 表里某条记录的 model_id（可填裸 model_id，桌面端会自动 upgrade 到复合 key）
            ['key' => 'chat_default_model_provider', 'value' => 'cloud:default', 'remark' => '桌面端对话默认模型服务商 ID（通常 cloud:default）'],
            ['key' => 'chat_default_model_id',       'value' => '',              'remark' => '桌面端对话默认模型 ID（cloud_models 表里的 model_id 或复合 key）'],
        ];
        foreach ($rows as $row) {
            // 已存在则跳过：幂等
            $exists = DB::table('system_settings')->where('key', $row['key'])->exists();
            if ($exists) continue;
            DB::table('system_settings')->insert(array_merge($row, [
                'created_at' => $now,
                'updated_at' => $now,
            ]));
        }
    }

    public function down()
    {
        DB::table('system_settings')
            ->whereIn('key', ['chat_default_model_provider', 'chat_default_model_id'])
            ->delete();
    }
};
