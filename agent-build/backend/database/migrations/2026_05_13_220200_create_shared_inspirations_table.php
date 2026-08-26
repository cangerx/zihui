<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 共享灵感库 v1：核心数据表。
 *
 * 设计要点：
 *  - cover_image 直接存云控端原 URL，hub 不转存图片副本（用户决策：URL 引用方案）
 *  - source_site_name 是云控端自报的「系统设置.站点名」快照，跟随分享时点写入
 *  - status 默认 pending，由审核员投票累计达阈值后流转为 approved / rejected
 *  - is_visible 是审核通过后的「临时下架」开关：被举报达 report_threshold
 *    会自动置 false，平台后台也可手动上下架
 *  - approve_count / reject_count / report_count / download_count 是冗余计数，
 *    用于 list 排序和阈值判断，避免每次都聚合 reviews/reports/downloads 表
 *  - UNIQUE (source_client_id, source_local_id) 防止同一个云控端站点的同一条灵感
 *    被重复分享到共享库
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('shared_inspirations', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';

            $table->bigIncrements('id');
            $table->unsignedBigInteger('category_id');
            $table->string('title', 100);
            $table->string('cover_image', 500)->comment('云控端原图 URL，hub 不转存');
            $table->text('prompt_cn')->nullable();
            $table->text('prompt_en')->nullable();

            // 来源溯源（云控端不可篡改 source_client_id：由 VerifyDomainBinding 注入）
            $table->string('source_client_id', 32)->comment('authorized_clients.client_id');
            $table->unsignedBigInteger('source_local_id')->comment('云控端本地 inspirations.id');
            $table->string('source_site_name', 100)->comment('云控端自报站名快照（来自 SystemSetting.site_title）');

            // 状态机
            $table->enum('status', ['pending', 'approved', 'rejected'])
                ->default('pending')
                ->comment('审核状态：pending=待审 / approved=已通过 / rejected=已驳回');
            $table->boolean('is_visible')
                ->default(true)
                ->comment('显示开关：举报达阈值或平台手动会置 false');
            $table->dateTime('reviewed_at')->nullable()->comment('达阈值流转时间');
            $table->dateTime('auto_hidden_at')->nullable()->comment('因举报自动下架的时间');

            // 冗余计数
            $table->unsignedInteger('approve_count')->default(0);
            $table->unsignedInteger('reject_count')->default(0);
            $table->unsignedInteger('report_count')->default(0);
            $table->unsignedInteger('download_count')->default(0);

            $table->timestamps();

            $table->unique(['source_client_id', 'source_local_id'], 'uniq_shared_source');
            $table->index(['status', 'is_visible'], 'idx_shared_audit');
            $table->index('category_id', 'idx_shared_category');

            $table->foreign('category_id', 'fk_shared_category')
                ->references('id')->on('shared_inspiration_categories')
                ->onDelete('restrict');

            $table->foreign('source_client_id', 'fk_shared_source_client')
                ->references('client_id')->on('authorized_clients')
                ->onDelete('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shared_inspirations');
    }
};
