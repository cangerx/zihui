<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * agents 表增加知识库检索选项（随 acquire 下发桌面端）。
 * - kb_only：仅依据知识库回答
 * - kb_top_k：每次检索召回的 chunk 数
 * 绑定的知识库本体走 agent_knowledge_bases pivot。
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('agents', function (Blueprint $table) {
            if (!Schema::hasColumn('agents', 'kb_only')) {
                $table->boolean('kb_only')->default(false)->after('enable_image_gen');
            }
            if (!Schema::hasColumn('agents', 'kb_top_k')) {
                $table->unsignedTinyInteger('kb_top_k')->default(6)->after('kb_only');
            }
        });
    }

    public function down(): void
    {
        Schema::table('agents', function (Blueprint $table) {
            if (Schema::hasColumn('agents', 'kb_top_k')) {
                $table->dropColumn('kb_top_k');
            }
            if (Schema::hasColumn('agents', 'kb_only')) {
                $table->dropColumn('kb_only');
            }
        });
    }
};
