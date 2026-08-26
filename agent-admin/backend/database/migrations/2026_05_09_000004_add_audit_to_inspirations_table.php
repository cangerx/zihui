<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 给 inspirations 表加审核 + 显示开关字段
 *
 * - status enum('pending','approved','rejected') default 'approved'
 *   桌面端用户通过 clientUpload 上传时初始为 pending，需管理员审核
 *   管理员后台手工录入时直接 approved（store 控制器层赋值）
 *   存量数据 default approved，避免升级后桌面端列表清空
 *
 * - is_visible boolean default true
 *   即使审核通过，仍可临时下架（运营策略 / 违规复核）
 *   桌面端 publicList 过滤 status=approved AND is_visible=true 才返回
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('inspirations', function (Blueprint $table) {
            $table->enum('status', ['pending', 'approved', 'rejected'])
                ->default('approved')
                ->after('uploader_nickname')
                ->comment('审核状态：pending=待审核 / approved=已通过 / rejected=已拒绝');
            $table->boolean('is_visible')
                ->default(true)
                ->after('status')
                ->comment('显示开关：true=桌面端可见 / false=已下架，与 status 独立');
            // 公开接口高频查询会同时筛 status + is_visible，加联合索引
            $table->index(['status', 'is_visible'], 'inspirations_audit_idx');
        });
    }

    public function down(): void
    {
        Schema::table('inspirations', function (Blueprint $table) {
            $table->dropIndex('inspirations_audit_idx');
            $table->dropColumn(['status', 'is_visible']);
        });
    }
};
