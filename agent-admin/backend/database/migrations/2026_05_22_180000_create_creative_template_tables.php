<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('creative_template_categories', function (Blueprint $table) {
            $table->id();
            $table->string('name', 50);
            $table->string('description', 500)->default('');
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('is_visible')->default(true);
            $table->timestamps();
        });

        Schema::create('creative_templates', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('category_id');
            $table->string('title', 100);
            $table->string('description', 500)->default('');
            $table->string('cover_image', 500)->default('');
            $table->json('example_ref_images')->nullable();
            $table->string('default_size', 50)->default('');
            $table->longText('prompt_template');
            $table->json('variables')->nullable();
            $table->string('source_type', 30)->default('manual');
            $table->string('source_image', 500)->default('');
            $table->unsignedBigInteger('source_inspiration_id')->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('is_visible')->default(true);
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->timestamps();

            $table->foreign('category_id')
                ->references('id')
                ->on('creative_template_categories')
                ->onDelete('cascade');
            $table->index(['category_id', 'is_visible']);
            $table->index(['source_type', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('creative_templates');
        Schema::dropIfExists('creative_template_categories');
    }
};
