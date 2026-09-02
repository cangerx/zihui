<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * 知识库切片表（用于 RAG hybrid 检索）
 *
 * 设计取舍：
 * - 业务元数据 + chunk 正文存 MySQL；向量存 Qdrant（point id = kb_chunks.id）
 * - kb_id denormalize 一份，便于 Qdrant payload 过滤与多库关键词检索
 * - chunk_text 建 FULLTEXT(ngram) 供中文关键词检索，与向量召回做 RRF 融合
 * - vec_indexed 标志位：写入 Qdrant 成功置 true，双库对账/重试用
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('kb_chunks', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('kb_id');
            $table->unsignedBigInteger('document_id');
            $table->unsignedInteger('chunk_idx');
            $table->mediumText('chunk_text');
            $table->string('embedding_model', 100)->nullable();
            $table->boolean('vec_indexed')->default(false);
            $table->unsignedInteger('token_count')->default(0);
            $table->timestamps();

            $table->foreign('document_id')
                ->references('id')
                ->on('kb_documents')
                ->onDelete('cascade');

            $table->index(['document_id', 'chunk_idx'], 'idx_kb_chunks_doc');
            $table->index(['kb_id'], 'idx_kb_chunks_kb');
            $table->index(['embedding_model', 'vec_indexed'], 'idx_kb_chunks_model_indexed');
        });

        // FULLTEXT + ngram parser 仅是 MySQL 的关键词召回优化。
        // SQLite/PostgreSQL 没有兼容的 MySQL FULLTEXT 语法，直接跳过索引；
        // 应用层会退化为向量检索，不影响表结构和数据写入。
        if (DB::connection()->getDriverName() !== 'mysql') {
            return;
        }

        // 某些 MySQL 发行版未启用 ngram 解析器时降级（关键词路退化，向量检索不受影响）。
        try {
            DB::statement('ALTER TABLE `kb_chunks` ADD FULLTEXT INDEX `ft_kb_chunks_text` (`chunk_text`) WITH PARSER ngram');
        } catch (\Throwable $e) {
            try {
                DB::statement('ALTER TABLE `kb_chunks` ADD FULLTEXT INDEX `ft_kb_chunks_text` (`chunk_text`)');
            } catch (\Throwable $e2) {
                // 全文索引创建失败不致命，留待运维手动补建
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('kb_chunks');
    }
};
