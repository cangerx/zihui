<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        Schema::create('app_conversations', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id')->index();
            $table->string('title', 160)->default('新对话');
            $table->string('model', 200);
            $table->unsignedBigInteger('cloud_model_id')->nullable()->index();
            $table->boolean('pinned')->default(false)->index();
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('cloud_model_id')->references('id')->on('cloud_models')->nullOnDelete();
            $table->index(['user_id', 'updated_at']);
        });

        Schema::create('app_messages', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('conversation_id')->index();
            $table->unsignedBigInteger('user_id')->index();
            $table->string('role', 20);
            $table->longText('content');
            $table->string('model', 200)->default('');
            $table->string('request_id', 36)->nullable()->index();
            $table->timestamps();

            $table->foreign('conversation_id')->references('id')->on('app_conversations')->onDelete('cascade');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->index(['conversation_id', 'created_at']);
        });
    }

    public function down()
    {
        Schema::dropIfExists('app_messages');
        Schema::dropIfExists('app_conversations');
    }
};
