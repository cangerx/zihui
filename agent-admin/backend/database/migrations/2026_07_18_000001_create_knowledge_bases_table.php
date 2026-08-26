<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 云端知识库主表（独立于「文档中心」doc_* 体系）
 *
 * 设计取舍：
 * - 知识库是顶层可命名单元，与智能体预设 N:N 绑定（agent_knowledge_bases）
 * - 业务元数据存 MySQL，chunk 向量存 Qdrant（按 payload kb_id 过滤隔离多库）
 * - embedding_model_id 允许按库覆盖；为空时用全局 kb_embedding_model_id（SystemSetting）
 * - visibility_scope 预留库级可见控制；当前访问控制主要随「智能体授权」传递
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('knowledge_bases', function (Blueprint $table) {
            $table->id();
            $table->string('name', 100);
            $table->string('description', 500)->default('');
            $table->string('visibility_scope', 20)->default('public'); // public / restricted
            $table->unsignedBigInteger('embedding_model_id')->nullable();
            $table->string('status', 20)->default('active'); // active / disabled
            $table->unsignedInteger('doc_count')->default(0);
            $table->unsignedInteger('chunk_count')->default(0);
            $table->boolean('is_visible')->default(true);
            $table->unsignedInteger('sort_order')->default(0);
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->timestamps();

            $table->index(['is_visible', 'sort_order', 'id'], 'idx_kb_vis_sort');
            $table->index(['status'], 'idx_kb_status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('knowledge_bases');
    }
};
