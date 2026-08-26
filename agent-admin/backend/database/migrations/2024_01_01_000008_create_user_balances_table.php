<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        Schema::create('user_balances', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id');
            $table->enum('balance_type', ['token', 'credit'])->default('token');
            $table->decimal('amount', 16, 4)->default(0);
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->unique(['user_id', 'balance_type']);
        });

        Schema::create('balance_logs', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id');
            $table->enum('balance_type', ['token', 'credit']);
            $table->decimal('change_amount', 16, 4);
            $table->decimal('balance_after', 16, 4);
            $table->string('change_type', 50);
            $table->string('remark', 500)->default('');
            $table->unsignedBigInteger('operator_id')->nullable();
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->index(['user_id', 'balance_type']);
            $table->index('change_type');
        });
    }

    public function down()
    {
        Schema::dropIfExists('balance_logs');
        Schema::dropIfExists('user_balances');
    }
};
