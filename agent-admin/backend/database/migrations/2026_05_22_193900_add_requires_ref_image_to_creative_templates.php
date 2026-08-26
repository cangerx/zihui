<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('creative_templates', function (Blueprint $table) {
            if (!Schema::hasColumn('creative_templates', 'requires_ref_image')) {
                $table->boolean('requires_ref_image')->default(false)->after('example_ref_images');
            }
        });
    }

    public function down(): void
    {
        Schema::table('creative_templates', function (Blueprint $table) {
            if (Schema::hasColumn('creative_templates', 'requires_ref_image')) {
                $table->dropColumn('requires_ref_image');
            }
        });
    }
};
