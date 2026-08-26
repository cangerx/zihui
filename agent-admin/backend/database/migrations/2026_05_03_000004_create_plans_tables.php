<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        // Plan master
        Schema::create('plans', function (Blueprint $table) {
            $table->id();
            $table->string('code', 50)->unique();
            $table->string('name', 100);
            $table->string('description', 500)->default('');
            $table->decimal('price', 16, 2)->default(0);
            $table->string('currency', 10)->default('CNY');
            $table->unsignedInteger('duration_days')->default(0); // 0 = 永久
            $table->decimal('token_quota', 16, 4)->default(0);
            $table->decimal('credit_quota', 16, 4)->default(0);
            $table->text('rate_limit_json')->nullable();
            $table->string('status', 20)->default('active'); // active | archived
            $table->unsignedInteger('sort')->default(0);
            $table->string('remark', 500)->default('');
            $table->timestamps();

            $table->index(['status', 'sort']);
        });

        // Models included in the plan
        Schema::create('plan_model_assignments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('plan_id');
            $table->unsignedBigInteger('cloud_model_id');
            $table->timestamps();

            $table->foreign('plan_id')->references('id')->on('plans')->onDelete('cascade');
            $table->foreign('cloud_model_id')->references('id')->on('cloud_models')->onDelete('cascade');
            $table->unique(['plan_id', 'cloud_model_id']);
        });

        // Permission policies applied by the plan
        Schema::create('plan_permissions', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('plan_id');
            $table->string('policy_key', 100);
            $table->text('policy_value');
            $table->timestamps();

            $table->foreign('plan_id')->references('id')->on('plans')->onDelete('cascade');
            $table->unique(['plan_id', 'policy_key']);
        });

        // User-held plans (historical + active)
        Schema::create('user_plans', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id');
            $table->unsignedBigInteger('plan_id');
            $table->string('source', 20)->default('admin'); // purchase | redeem | admin | register
            $table->timestamp('activated_at')->nullable();
            $table->timestamp('expires_at')->nullable(); // null = 永久
            $table->string('status', 20)->default('active'); // active | expired | revoked
            $table->decimal('token_granted', 16, 4)->default(0);
            $table->decimal('credit_granted', 16, 4)->default(0);
            $table->text('policy_snapshot_json')->nullable(); // 覆盖前的原 policy 值（恢复时用）
            $table->string('remark', 500)->default('');
            $table->unsignedBigInteger('operator_id')->nullable();
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('plan_id')->references('id')->on('plans');
            $table->index(['user_id', 'status']);
            $table->index(['status', 'expires_at']);
        });
    }

    public function down()
    {
        Schema::dropIfExists('user_plans');
        Schema::dropIfExists('plan_permissions');
        Schema::dropIfExists('plan_model_assignments');
        Schema::dropIfExists('plans');
    }
};
