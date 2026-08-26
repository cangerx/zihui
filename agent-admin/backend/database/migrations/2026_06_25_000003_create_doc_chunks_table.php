<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 文档切片表（用于 RAG 检索）
 *
 * 设计取舍：
 * - 业务元数据存 MySQL，向量另存 SQLite（docvec connection）
 *   通过 doc_chunks.id 作为外键关联，主从两库通过 chunk_id 配对
 * - embedding_model 字段记录所用 embedding 模型；切换模型时按此筛选批量重建
 * - vec_indexed 标志位：写入 SQLite 向量库成功后置 true，用于双库不一致时的对账与重试
 * - chunk_text 已剥 HTML 的纯文本切片正文；token_count 由切片器估算
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('doc_chunks', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('doc_id');
            $table->unsignedInteger('chunk_idx');
            $table->mediumText('chunk_text');
            $table->string('embedding_model', 100)->nullable();
            $table->boolean('vec_indexed')->default(false);
            $table->unsignedInteger('token_count')->default(0);
            $table->timestamps();

            $table->foreign('doc_id')
                ->references('id')
                ->on('docs')
                ->onDelete('cascade');

            $table->index(['doc_id', 'chunk_idx'], 'idx_doc_chunks_doc');
            $table->index(['embedding_model', 'vec_indexed'], 'idx_doc_chunks_model_indexed');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('doc_chunks');
    }
};
