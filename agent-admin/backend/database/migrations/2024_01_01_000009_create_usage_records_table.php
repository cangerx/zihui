<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        Schema::create('usage_records', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id');
            $table->unsignedBigInteger('cloud_model_id');
            $table->enum('type', ['chat', 'image', 'embedding'])->default('chat');
            $table->integer('prompt_tokens')->default(0);
            $table->integer('completion_tokens')->default(0);
            $table->integer('total_tokens')->default(0);
            $table->decimal('credits_used', 10, 4)->default(0);
            $table->decimal('cost', 16, 8)->default(0);
            $table->enum('status', ['success', 'failed'])->default('success');
            $table->string('request_id', 100)->default('');
            $table->string('remark', 500)->default('');
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('cloud_model_id')->references('id')->on('cloud_models')->onDelete('cascade');
            $table->index(['user_id', 'created_at']);
            $table->index(['cloud_model_id', 'created_at']);
            $table->index('type');
            $table->index('status');
        });
    }

    public function down()
    {
        Schema::dropIfExists('usage_records');
    }
};
