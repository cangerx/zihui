<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 行业话术包表：为不同模板（template）准备多套行业文案预设。
 *
 * 设计思路：
 *  - 话术包不参与运行时合并，仅作为"批量预设填充"工具。
 *  - 管理员在后台选中一个话术包并 apply 时，后端把 payload 中的 K/V
 *    批量写入 system_settings，前台官网 fetch 公开配置时即生效。
 *  - 切话术包 = 先 reset 当前模板的专属字段（按前缀筛选），再写入 payload。
 *  - is_builtin = 1 的话术包不可删除（避免误删系统预设），但 payload 仍可编辑。
 *
 * 唯一索引 (template, slug)：同一模板内 slug 不能重复，跨模板可重名。
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('homepage_phrase_packs', function (Blueprint $table) {
            $table->id();
            // 归属模板代号：default / minimal / 未来可扩展
            $table->string('template', 32)->index();
            // 话术包 slug：英文小写、数字、下划线、连字符
            $table->string('slug', 80);
            // 话术包显示名称
            $table->string('name', 120);
            // 简短描述（行业 / 适用场景）
            $table->string('description', 500)->nullable();
            // 字段映射 JSON：{ homepage_xxx: '...', minimal_xxx: '...' }
            // 仅 HomepageController::TEXT_KEYS 白名单内的 key 会被 apply 写入
            $table->json('payload');
            // 系统预置标志：1 不可删除（仅可编辑文本），0 用户自建可删
            $table->boolean('is_builtin')->default(false);
            // 后台列表显示顺序（小数字在前）
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();

            $table->unique(['template', 'slug']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('homepage_phrase_packs');
    }
};
