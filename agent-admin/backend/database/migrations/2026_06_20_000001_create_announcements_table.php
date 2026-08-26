<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('announcements', function (Blueprint $table) {
            $table->id();
            // 公告标题（admin 列表 / 客户端弹窗标题用）
            $table->string('title', 200);
            // 富文本正文（HTML），客户端 v-html 渲染。10MB 上限够任意正文 + 简单嵌入图片 data-uri
            $table->longText('content');
            // 是否启用：客户端只拉 enabled=1 的最新一条
            $table->boolean('enabled')->default(true);
            // 排序（数值大的先展示，便于人工置顶）；同值按 id desc 兜底
            $table->integer('sort_order')->default(0);
            $table->timestamps();

            // 客户端 current 接口热点查询：where enabled=1 order by sort_order desc, id desc limit 1
            $table->index(['enabled', 'sort_order', 'id'], 'idx_announcements_active');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('announcements');
    }
};
