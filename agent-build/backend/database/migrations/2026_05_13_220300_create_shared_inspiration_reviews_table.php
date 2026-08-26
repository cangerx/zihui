<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 共享灵感库 v1：审核员投票表。
 *
 *  - 一个审核员对一条灵感只能投一票（UNIQUE 约束兜底，业务层先做 lockForUpdate + 状态机校验）
 *  - 不可撤销（用户决策）：投过的票不允许 update/delete，UI 上按钮 disable
 *  - reason 在 action=reject 时业务层强制必填，approve 可空
 *  - 审核员可对自己 client 名下的灵感投票（用户决策：可自审）
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('shared_inspiration_reviews', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';

            $table->bigIncrements('id');
            $table->unsignedBigInteger('shared_id');
            $table->string('reviewer_client_id', 32);
            $table->enum('action', ['approve', 'reject']);
            $table->string('reason', 255)->nullable()->comment('reject 时由业务层强制必填');
            $table->dateTime('created_at');

            $table->unique(['shared_id', 'reviewer_client_id'], 'uniq_review_one_vote');
            $table->index(['shared_id', 'action'], 'idx_review_shared_action');

            $table->foreign('shared_id', 'fk_review_shared')
                ->references('id')->on('shared_inspirations')
                ->onDelete('cascade');

            $table->foreign('reviewer_client_id', 'fk_review_reviewer')
                ->references('client_id')->on('authorized_clients')
                ->onDelete('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shared_inspiration_reviews');
    }
};
