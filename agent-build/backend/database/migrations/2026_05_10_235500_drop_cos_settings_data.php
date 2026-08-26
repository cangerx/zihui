<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * 0.5.0：随家庭电脑中转方案上线，腾讯云 COS 配置组退役。
 *
 * 删除 system_settings 表 group_key='cos' 的所有行（region/bucket/app_id/secret_id/secret_key/custom_domain）。
 *
 * - cos_object_prefix 字段（build_requests）保留，向后查询历史 cos build 用，不再写入新数据
 * - CosService.php / SignatureService.php 文件保留作为历史资源（git log）
 * - admin UI 系统设置页面 + 3 个 settings/cos 路由已下线
 *
 * 不可逆：down 不恢复（COS 已下线，不应该回滚到 COS 直传方案）。
 */
return new class extends Migration {
    public function up(): void
    {
        $deleted = DB::table('system_settings')->where('group_key', 'cos')->delete();
        // 用 info 级别日志记录删除条数，便于线上 deploy 审计
        if (function_exists('logger')) {
            logger()->info('[migration] 0.5.0 cos settings rows deleted', ['count' => $deleted]);
        }
    }

    public function down(): void
    {
        // 不恢复 COS 配置：方案已退役。如需历史数据请从 DB 备份恢复。
    }
};
