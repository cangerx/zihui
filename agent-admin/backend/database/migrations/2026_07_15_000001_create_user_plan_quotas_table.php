<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        Schema::create('user_plan_quotas', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id');
            $table->unsignedBigInteger('user_plan_id');
            $table->unsignedBigInteger('plan_id')->nullable();
            $table->enum('balance_type', ['token', 'credit']);
            $table->decimal('granted', 16, 4)->default(0);
            $table->decimal('consumed', 16, 4)->default(0);
            $table->timestamp('expires_at')->nullable();
            $table->enum('status', ['active', 'expired', 'revoked'])->default('active');
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('user_plan_id')->references('id')->on('user_plans')->onDelete('cascade');

            $table->index(['user_id', 'balance_type', 'status', 'expires_at'], 'upq_consume_idx');
            $table->index(['user_plan_id', 'balance_type'], 'upq_plan_type_idx');
            $table->index('status');
        });
    }

    public function down()
    {
        Schema::dropIfExists('user_plan_quotas');
    }
};
