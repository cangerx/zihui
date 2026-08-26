<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 生图风格预设表。
 *
 * 「风格预设」= 一段命名的提示词片段，由云控端后台维护，桌面端
 * （AI 生图 / 批量生图 / 画布文生图 / 图生图 / 快捷编排）通过
 * /api/public/style-presets/* 拉取后拼接到生图提示词尾部。
 * 无投稿/审核流程，纯后台 CRUD；is_enabled=false 即对桌面端不可见。
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('style_presets')) {
            return;
        }

        Schema::create('style_presets', function (Blueprint $table) {
            $table->id();
            $table->string('name', 50)->comment('风格名称');
            $table->text('prompt_fragment')->comment('风格提示词片段（自然语言，拼接到用户提示词尾部）');
            $table->string('sample_image', 500)->default('')->comment('示例图 URL（可空，空则桌面端显示纯文字卡）');
            $table->string('category', 50)->default('')->comment('分类名（手填字符串，如 写实/动漫/插画）');
            $table->integer('sort_order')->default(0)->comment('排序，小的在前');
            $table->boolean('is_enabled')->default(true)->comment('是否启用（停用后桌面端不可见）');
            $table->timestamps();

            $table->index(['is_enabled', 'sort_order'], 'style_presets_enabled_sort_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('style_presets');
    }
};
