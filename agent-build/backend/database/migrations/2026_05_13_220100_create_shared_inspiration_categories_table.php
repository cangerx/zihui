<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 共享灵感库 v1：标准化分类表（平台方维护，云控端只读）。
 *
 * 14 个默认分类由 SharedInspirationCategorySeeder 写入：人物肖像 / 风景自然 / 建筑空间 ……
 * slug 为 kebab-case，用于云控端展示和路由稳定标识。
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('shared_inspiration_categories', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';

            $table->bigIncrements('id');
            $table->string('name', 50)->comment('分类显示名（中文）');
            $table->string('slug', 50)->unique('uniq_shared_category_slug')->comment('英文 slug，云控端持久标识');
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shared_inspiration_categories');
    }
};
