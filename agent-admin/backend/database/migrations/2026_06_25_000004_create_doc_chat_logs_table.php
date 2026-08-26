<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 文档 RAG 问答日志：审计 + 防刷 + 用量统计
 *
 * 设计取舍：
 * - user_id 可空：游客提问场景（docs_chat_allow_guest=true）user_id=null
 * - 不计费但仍记录 token 数；admin 可在「用量统计」按 type='docs_rag' 反查（实际写到本表，不污染 usage_records）
 * - cited_doc_ids JSON 记录命中的文档 ID 列表，用于审计 + 前端引用展示
 * - status: success / failed（上游报错）/ no_match（无文档命中，AI 回答了「文档中未找到相关信息」）
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('doc_chat_logs', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id')->nullable();
            $table->string('session_id', 64);
            $table->text('query');
            $table->longText('answer')->nullable();
            $table->json('cited_doc_ids');
            $table->unsignedInteger('latency_ms')->default(0);
            $table->unsignedInteger('total_tokens')->default(0);
            $table->string('status', 16)->default('success');
            $table->string('error', 500)->nullable();
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('set null');
            $table->index(['session_id', 'id'], 'idx_doc_chat_logs_session');
            $table->index(['user_id', 'created_at'], 'idx_doc_chat_logs_user');
            $table->index('created_at', 'idx_doc_chat_logs_created');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('doc_chat_logs');
    }
};
