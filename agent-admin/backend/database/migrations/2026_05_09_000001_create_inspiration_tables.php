<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inspiration_categories', function (Blueprint $table) {
            $table->id();
            $table->string('name', 50);
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
        });

        Schema::create('inspirations', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('category_id');
            $table->string('title', 100);
            $table->string('cover_image', 500)->default('');
            $table->text('prompt_cn')->nullable();
            $table->text('prompt_en')->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();

            $table->foreign('category_id')
                  ->references('id')
                  ->on('inspiration_categories')
                  ->onDelete('cascade');
            $table->index('category_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inspirations');
        Schema::dropIfExists('inspiration_categories');
    }
};
