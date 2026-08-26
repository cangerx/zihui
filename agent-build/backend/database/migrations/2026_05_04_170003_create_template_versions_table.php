<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('template_versions', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';

            $table->bigIncrements('id');
            $table->string('version', 20)->unique();
            $table->dateTime('released_at');
            $table->text('changelog')->nullable();
            $table->tinyInteger('is_current')->default(0);
            $table->string('released_by', 50)->nullable()->comment('运营操作人');
            $table->dateTime('created_at');
            $table->dateTime('updated_at');

            $table->index('is_current', 'idx_is_current');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('template_versions');
    }
};
