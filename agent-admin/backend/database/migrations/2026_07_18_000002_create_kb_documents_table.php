<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 知识库文档表
 *
 * 录入两种来源（source_type）：
 * - richtext：后台富文本在线编辑（content_html 富文本源）
 * - upload  ：上传文件由 PHP 端解析（PDF/Word/Markdown/TXT/Excel）后统一转 content_html
 * content_plain 为剥标签纯文本，供 hybrid 关键词检索与展示。
 * index_status 跟踪向量化状态（异步队列驱动）。
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('kb_documents', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('kb_id');
            $table->string('title', 200);
            $table->string('source_type', 20)->default('richtext'); // richtext / upload
            $table->string('original_filename', 255)->default('');
            $table->longText('content_html');
            $table->longText('content_plain');
            $table->unsignedBigInteger('file_size')->default(0);
            $table->string('index_status', 20)->default('pending'); // pending/processing/ready/failed
            $table->string('index_error', 500)->default('');
            $table->unsignedInteger('chunk_count')->default(0);
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();

            $table->foreign('kb_id')
                ->references('id')
                ->on('knowledge_bases')
                ->onDelete('cascade');

            $table->index(['kb_id', 'index_status', 'id'], 'idx_kb_docs_kb_status');
            $table->index(['kb_id', 'sort_order', 'id'], 'idx_kb_docs_kb_sort');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('kb_documents');
    }
};
