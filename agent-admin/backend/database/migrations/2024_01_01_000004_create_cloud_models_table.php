<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        Schema::create('cloud_models', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('provider_id');
            $table->string('model_id', 200);
            $table->string('name', 200);
            $table->enum('type', ['chat', 'image', 'embedding'])->default('chat');
            $table->enum('status', ['active', 'disabled'])->default('active');
            $table->string('remark', 500)->default('');
            $table->timestamps();

            $table->foreign('provider_id')->references('id')->on('cloud_providers')->onDelete('cascade');
            $table->unique(['provider_id', 'model_id']);
            $table->index('type');
            $table->index('status');
        });
    }

    public function down()
    {
        Schema::dropIfExists('cloud_models');
    }
};
