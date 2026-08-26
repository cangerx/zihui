<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 文档主表：富文本图文文档存储
 *
 * 关键字段：
 * - content_html  富文本 HTML，前端 v-html 渲染（内容源可信，admin 控制）
 * - content_plain strip_tags 后的纯文本，专供 LIKE 全文模糊搜索（写入时同步生成）
 * - slug          可空，用于前端友好 URL /docs/d/{slug}；空时回落 id
 * - is_visible    显示开关，false 时公开端绝对不可见、不可搜
 * - import_source 审计字段：manual / md / docx
 *
 * 索引设计：
 * - (category_id, is_visible, sort_order, id)：分类内列表 + 过滤可见性 + 排序
 * - (is_visible, sort_order, id)：全局列表
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('docs', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('category_id');
            $table->string('title', 200);
            $table->string('subtitle', 300)->nullable();
            $table->longText('content_html');
            $table->longText('content_plain');
            $table->string('slug', 120)->nullable()->unique();
            $table->boolean('is_visible')->default(true);
            $table->unsignedInteger('sort_order')->default(0);
            $table->unsignedInteger('view_count')->default(0);
            $table->string('import_source', 20)->nullable();
            $table->timestamps();

            $table->foreign('category_id')
                ->references('id')
                ->on('doc_categories')
                ->onDelete('restrict');

            $table->index(['category_id', 'is_visible', 'sort_order', 'id'], 'idx_docs_cat_vis_sort');
            $table->index(['is_visible', 'sort_order', 'id'], 'idx_docs_vis_sort');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('docs');
    }
};
