<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('inspirations', function (Blueprint $table) {
            if (!Schema::hasColumn('inspirations', 'cover_thumb')) {
                $table->string('cover_thumb', 500)->default('')->after('cover_image');
            }
        });
    }

    public function down(): void
    {
        Schema::table('inspirations', function (Blueprint $table) {
            if (Schema::hasColumn('inspirations', 'cover_thumb')) {
                $table->dropColumn('cover_thumb');
            }
        });
    }
};
