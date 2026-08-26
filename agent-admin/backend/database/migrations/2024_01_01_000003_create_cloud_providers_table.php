<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        Schema::create('cloud_providers', function (Blueprint $table) {
            $table->id();
            $table->string('name', 100);
            $table->string('type', 50)->default('openai_compatible');
            $table->string('api_base', 500);
            $table->text('api_key');
            $table->enum('status', ['active', 'disabled'])->default('active');
            $table->string('remark', 500)->default('');
            $table->timestamps();
        });
    }

    public function down()
    {
        Schema::dropIfExists('cloud_providers');
    }
};
