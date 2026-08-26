<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('shared_inspirations', function (Blueprint $table) {
            if (!Schema::hasColumn('shared_inspirations', 'ref_images')) {
                $table->json('ref_images')->nullable()->after('cover_image');
            }
            if (!Schema::hasColumn('shared_inspirations', 'generation_size')) {
                $table->string('generation_size', 50)->nullable()->after('ref_images');
            }
        });
    }

    public function down(): void
    {
        Schema::table('shared_inspirations', function (Blueprint $table) {
            if (Schema::hasColumn('shared_inspirations', 'generation_size')) {
                $table->dropColumn('generation_size');
            }
            if (Schema::hasColumn('shared_inspirations', 'ref_images')) {
                $table->dropColumn('ref_images');
            }
        });
    }
};
