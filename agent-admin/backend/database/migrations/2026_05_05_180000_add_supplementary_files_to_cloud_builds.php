<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('cloud_builds', function (Blueprint $table) {
            $table->json('supplementary_files')->nullable()->after('stored_path')
                ->comment('latest.yml + .blockmap (electron-updater 三件套): [{filename,role,size,sha256,download_url}]');
        });
    }

    public function down(): void
    {
        Schema::table('cloud_builds', function (Blueprint $table) {
            $table->dropColumn('supplementary_files');
        });
    }
};
