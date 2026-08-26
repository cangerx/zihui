<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('plan_categories')) {
            Schema::create('plan_categories', function (Blueprint $table) {
                $table->id();
                $table->string('name', 100);
                $table->unsignedInteger('sort_order')->default(0);
                $table->timestamps();

                $table->index(['sort_order', 'id']);
            });
        }

        if (Schema::hasTable('plans') && !Schema::hasColumn('plans', 'category_id')) {
            Schema::table('plans', function (Blueprint $table) {
                $table->unsignedBigInteger('category_id')->nullable()->after('id')->index();
                $table->foreign('category_id')->references('id')->on('plan_categories')->nullOnDelete();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('plans') && Schema::hasColumn('plans', 'category_id')) {
            Schema::table('plans', function (Blueprint $table) {
                $table->dropForeign(['category_id']);
                $table->dropIndex(['category_id']);
                $table->dropColumn('category_id');
            });
        }

        Schema::dropIfExists('plan_categories');
    }
};
