<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 文档分类表：文档管理功能的二级目录组织
 *
 * 设计取舍：
 * - 仅两级（分类 → 文档），不设 parent_id 自关联，简单可控
 * - slug 用于文档前端友好 URL（/docs/c/{slug}），可空（空时前端用 id）
 * - sort_order 数值大者前置，与 announcements / inspirations 表保持一致
 *
 * 后续追加字段：is_visible 由 2026_06_25_000005_add_is_visible_to_doc_categories
 * 单独追加，避免修改已发布 migration（migration 铁律：永远只增不改）
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('doc_categories', function (Blueprint $table) {
            $table->id();
            $table->string('name', 50);
            $table->string('slug', 80)->nullable()->unique();
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();

            // 列表排序热点：ORDER BY sort_order DESC, id DESC
            $table->index(['sort_order', 'id'], 'idx_doc_categories_sort');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('doc_categories');
    }
};
