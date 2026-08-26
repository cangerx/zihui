<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 共享灵感库 v1：举报表。
 *
 *  - 同一个 client 对一条灵感只能举报一次（UNIQUE 约束）
 *  - reason_code 是固定 5 枚举（invalid_image / inappropriate / duplicate / copyright / other），
 *    具体枚举值的合法性由控制器 Validator 校验，不在表层用 ENUM 约束（方便后续扩展）
 *  - reason_note 是用户可选填的备注，便于后台审核员看上下文
 *  - 累计 report_count >= report_threshold 时业务层把 shared_inspirations.is_visible 置 false
 *    （不删 reports 行，平台后台可看举报池处理后续动作）
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('shared_inspiration_reports', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';

            $table->bigIncrements('id');
            $table->unsignedBigInteger('shared_id');
            $table->string('reporter_client_id', 32);
            $table->string('reason_code', 30)->comment('invalid_image/inappropriate/duplicate/copyright/other');
            $table->string('reason_note', 255)->nullable()->comment('用户可选备注');
            $table->dateTime('created_at');

            $table->unique(['shared_id', 'reporter_client_id'], 'uniq_report_one_per_client');
            $table->index('shared_id', 'idx_report_shared');
            $table->index('reporter_client_id', 'idx_report_reporter');

            $table->foreign('shared_id', 'fk_report_shared')
                ->references('id')->on('shared_inspirations')
                ->onDelete('cascade');

            $table->foreign('reporter_client_id', 'fk_report_reporter')
                ->references('client_id')->on('authorized_clients')
                ->onDelete('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shared_inspiration_reports');
    }
};
