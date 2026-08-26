<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        Schema::create('image_tasks', function (Blueprint $table) {
            $table->string('id', 36)->primary();
            $table->unsignedBigInteger('user_id')->index();
            $table->unsignedBigInteger('cloud_model_id');
            $table->string('endpoint', 20);
            $table->json('request_body');
            $table->string('status', 20)->default('pending')->index();
            $table->json('result')->nullable();
            $table->text('error')->nullable();
            $table->decimal('cost', 16, 6)->default(0);
            $table->string('request_id', 36);
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Schema::dropIfExists('image_tasks');
    }
};
