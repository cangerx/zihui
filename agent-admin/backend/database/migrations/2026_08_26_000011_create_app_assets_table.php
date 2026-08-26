<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        if (Schema::hasTable('app_assets')) return;
        Schema::create('app_assets', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->unsignedBigInteger('user_id')->index();
            $table->string('kind', 20)->default('image');
            $table->string('original_name', 255)->default('image');
            $table->string('storage_driver', 20);
            $table->string('object_key', 512);
            $table->string('storage_url', 1200)->default('');
            $table->string('declared_mime', 100);
            $table->string('detected_mime', 100)->nullable();
            $table->unsignedBigInteger('expected_size');
            $table->unsignedBigInteger('actual_size')->nullable();
            $table->char('sha256', 64)->nullable();
            $table->string('status', 20)->default('pending')->index();
            $table->timestamp('expires_at')->nullable()->index();
            $table->timestamp('upload_expires_at')->nullable();
            $table->char('nonce_hash', 64)->nullable();
            $table->timestamp('consumed_at')->nullable();
            $table->timestamp('lease_until')->nullable()->index();
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->index(['user_id', 'status', 'expires_at']);
        });
    }

    public function down()
    {
        Schema::dropIfExists('app_assets');
    }
};
