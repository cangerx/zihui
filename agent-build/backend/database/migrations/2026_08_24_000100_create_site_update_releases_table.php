<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('site_update_releases', function (Blueprint $table) {
            $table->id();
            $table->string('channel', 32)->default('admin');
            $table->string('version', 32);
            $table->text('changelog')->nullable();
            $table->string('zip_path', 500)->nullable();
            $table->string('zip_url', 500)->nullable();
            $table->string('sha256', 64)->nullable();
            $table->unsignedBigInteger('size')->default(0);
            $table->string('min_upgradable_from', 32)->nullable();
            $table->boolean('breaking')->default(false);
            $table->boolean('is_current')->default(false);
            $table->string('released_by', 80)->nullable();
            $table->dateTime('released_at')->nullable();
            $table->timestamps();
            $table->unique(['channel', 'version']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('site_update_releases');
    }
};
