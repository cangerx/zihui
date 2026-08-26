<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        Schema::create('update_logs', function (Blueprint $table) {
            $table->id();
            $table->string('from_version', 32);
            $table->string('to_version', 32);
            $table->string('status', 20)->default('running');
            // running | success | failed
            $table->string('phase', 32)->default('init');
            // init | downloading | verifying | backing_up | extracting | migrating | clearing_cache | completed
            $table->unsignedTinyInteger('progress_percent')->default(0);
            $table->longText('log')->nullable();
            $table->text('error_message')->nullable();
            $table->string('zip_url', 500)->default('');
            $table->string('zip_sha256', 64)->default('');
            $table->unsignedBigInteger('zip_size')->default(0);
            $table->string('backup_path', 500)->default('');
            $table->unsignedBigInteger('operator_id')->nullable();
            $table->string('operator_name', 100)->default('');
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->unsignedInteger('duration_seconds')->nullable();
            $table->timestamps();

            $table->index('status');
            $table->index(['status', 'created_at']);
        });
    }

    public function down()
    {
        Schema::dropIfExists('update_logs');
    }
};
