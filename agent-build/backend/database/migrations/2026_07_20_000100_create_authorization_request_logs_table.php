<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 授权请求记录表：记录 VerifyDomainBinding 每次云控端授权校验的判定结果，
 * 供管理端「请求记录」页排查「域名已授权却报未授权」——可看到客户端实际发来的
 * Origin / host 与拒因。仅用 Schema:: 原生 API，不依赖任何业务 Model。
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('authorization_request_logs', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';

            $table->id();
            $table->string('result', 16);                   // allowed | denied
            $table->string('reason', 32);                   // ok | origin_required | invalid_origin | domain_not_authorized | client_inactive | client_expired
            $table->string('origin', 255)->nullable();      // 归一化后 Origin（截断）
            $table->string('host', 255)->nullable();        // extractHost 结果（小写 host）
            $table->string('referer', 512)->nullable();     // Origin 缺失时用于定位来源页
            $table->string('client_id', 32)->nullable();    // 命中授权行时回填
            $table->string('client_status', 20)->nullable();
            $table->string('ip', 45)->nullable();           // 兼容 IPv6
            $table->string('user_agent', 512)->nullable();
            $table->string('admin_version', 32)->nullable(); // X-Admin-Version
            $table->string('method', 10)->nullable();
            $table->string('path', 255)->nullable();
            $table->timestamps();

            $table->index('result');
            $table->index(['reason', 'created_at']);
            $table->index(['host', 'created_at']);
            $table->index(['client_id', 'created_at']);
            $table->index('created_at');                    // 供保留清理扫描
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('authorization_request_logs');
    }
};
