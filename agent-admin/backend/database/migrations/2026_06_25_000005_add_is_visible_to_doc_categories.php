<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * doc_categories 表追加 is_visible 字段（与索引）。
 *
 * 1.3.11 dev 期间一度把 is_visible 写进 000001 migration，但已有开发 / 测试环境
 * 跑过老版 000001（无该字段），那些库再升级到 1.3.11 时不会重跑同名 migration，
 * 字段始终缺失。按 migration 铁律「已发布永不改」，把 000001 回滚到原始无该字段
 * 状态，并由本 migration 单独追加。
 *
 * 幂等：用 hasColumn / hasIndex 检查后再加，新装站点（000001 新版会包含字段时）
 * 也能安全跳过——但当前 000001 已经回滚为不含字段，所以新装站点必须靠这个 migration
 * 才有 is_visible，不会被跳过的代码路径影响。
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('doc_categories', 'is_visible')) {
            Schema::table('doc_categories', function (Blueprint $table) {
                $table->boolean('is_visible')->default(true)->after('sort_order');
            });
        }

        // public 列表过滤热点：WHERE is_visible = true ORDER BY sort_order DESC
        // hasIndex 自 Laravel 11+ 才稳定可用；用 try/catch 兜底以兼容更老版本
        try {
            Schema::table('doc_categories', function (Blueprint $table) {
                $table->index(['is_visible', 'sort_order', 'id'], 'idx_doc_categories_vis_sort');
            });
        } catch (\Throwable $e) {
            // 索引已存在 → 忽略（典型错误：Duplicate key name）
        }
    }

    public function down(): void
    {
        Schema::table('doc_categories', function (Blueprint $table) {
            try {
                $table->dropIndex('idx_doc_categories_vis_sort');
            } catch (\Throwable $e) {
                // 索引不存在则忽略
            }
            if (Schema::hasColumn('doc_categories', 'is_visible')) {
                $table->dropColumn('is_visible');
            }
        });
    }
};
