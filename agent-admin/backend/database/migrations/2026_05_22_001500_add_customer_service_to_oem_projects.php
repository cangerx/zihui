<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('oem_projects')) {
            return;
        }

        Schema::table('oem_projects', function (Blueprint $table) {
            if (!Schema::hasColumn('oem_projects', 'customer_service_title')) {
                $table->string('customer_service_title', 50)->nullable()->after('status');
            }
            if (!Schema::hasColumn('oem_projects', 'customer_service_image_url')) {
                $table->string('customer_service_image_url', 500)->nullable()->after('customer_service_title');
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('oem_projects')) {
            return;
        }

        Schema::table('oem_projects', function (Blueprint $table) {
            if (Schema::hasColumn('oem_projects', 'customer_service_image_url')) {
                $table->dropColumn('customer_service_image_url');
            }
            if (Schema::hasColumn('oem_projects', 'customer_service_title')) {
                $table->dropColumn('customer_service_title');
            }
        });
    }
};
