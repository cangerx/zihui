<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 国有化 personal_access_tokens 表（Laravel Sanctum）。
 *
 * 背景：Sanctum 2.x 的建表 migration 文件位于 vendor/laravel/sanctum/database/migrations/，
 * 依赖 Laravel package discovery 注册 SanctumServiceProvider 后才能被 `php artisan migrate`
 * 命令自动发现。部分新装环境在首次安装 / composer 优化产出 bootstrap/cache/packages.php 的
 * 时序问题下，该 vendor migration 未被注册进迁移流程，migrate 直接跳过它，最终数据库缺表，
 * 管理后台「在线更新 → 数据表完整性检查」页面会报缺失 personal_access_tokens。
 *
 * 本 migration 把建表动作直接写进项目 database/migrations/，从此不再依赖 vendor 发现机制，
 * 新装环境靠项目自己的 migration 就能稳定建表。
 *
 * 兼容老服务器：up() 开头用 Schema::hasTable 幂等短路。老机器已存在此表的直接返回，
 * migrations 表仍会写入一条本 migration 已执行的记录，下次 migrate 不会再触发 DDL。
 *
 * 表结构与 Sanctum vendor migration 严格一致，保证 Sanctum HasApiTokens / Guard 运行时无差异。
 */
return new class extends Migration
{
    public function up()
    {
        if (Schema::hasTable('personal_access_tokens')) {
            return;
        }

        Schema::create('personal_access_tokens', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->morphs('tokenable');
            $table->string('name');
            $table->string('token', 64)->unique();
            $table->text('abilities')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->timestamps();
        });
    }

    public function down()
    {
        Schema::dropIfExists('personal_access_tokens');
    }
};
