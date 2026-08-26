<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 智能体预设 ↔ 知识库 绑定（N:N pivot）
 *
 * 一个智能体可绑定多个知识库；acquire 时下发 kb_ids 给桌面端。
 * 桌面端检索权随智能体授权传递：用户拥有该 agent 即可检索其绑定的知识库。
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('agent_knowledge_bases', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('agent_id');
            $table->unsignedBigInteger('knowledge_base_id');
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();

            $table->foreign('agent_id')
                ->references('id')
                ->on('agents')
                ->onDelete('cascade');
            $table->foreign('knowledge_base_id')
                ->references('id')
                ->on('knowledge_bases')
                ->onDelete('cascade');

            $table->unique(['agent_id', 'knowledge_base_id'], 'uniq_agent_kb');
            $table->index(['knowledge_base_id'], 'idx_agent_kb_kb');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('agent_knowledge_bases');
    }
};
