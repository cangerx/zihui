<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('build_quotas', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';

            $table->bigIncrements('id');
            $table->string('client_id', 32);
            $table->date('date');
            $table->integer('count')->default(0);
            $table->dateTime('created_at');
            $table->dateTime('updated_at');

            $table->unique(['client_id', 'date'], 'uq_client_date');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('build_quotas');
    }
};
