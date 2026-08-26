<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        Schema::create('redeem_codes', function (Blueprint $table) {
            $table->id();
            $table->string('code', 64)->unique();
            $table->string('type', 20)->default('bundle'); // balance | credit | plan | bundle
            $table->text('reward_json'); // JSON: {token, credit, plan_id}
            $table->unsignedInteger('max_uses')->default(1);  // 0 = unlimited
            $table->unsignedInteger('used_count')->default(0);
            $table->unsignedInteger('per_user_limit')->default(1); // 0 = unlimited per user
            $table->timestamp('starts_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->string('status', 20)->default('active'); // active | disabled
            $table->string('batch_id', 64)->nullable();
            $table->string('remark', 500)->default('');
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();

            $table->index(['status', 'expires_at']);
            $table->index('batch_id');
        });

        Schema::create('redeem_records', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('code_id');
            $table->unsignedBigInteger('user_id');
            $table->text('reward_snapshot_json');
            $table->string('ip', 45)->nullable();
            $table->string('user_agent', 255)->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->foreign('code_id')->references('id')->on('redeem_codes')->onDelete('cascade');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            // 不能用 unique(code_id,user_id)：与 per_user_limit > 1 冲突
            // 幂等由应用层 lockForUpdate + per_user_limit 比较保证
            $table->index(['code_id', 'user_id']);
            $table->index(['user_id', 'created_at']);
        });
    }

    public function down()
    {
        Schema::dropIfExists('redeem_records');
        Schema::dropIfExists('redeem_codes');
    }
};
