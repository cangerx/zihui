<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('build_requests', function (Blueprint $table) {
            $table->json('artifact_files')->nullable()->after('artifact_sha256')
                ->comment('All artifact files (primary + supplementary): [{filename,relative_path,size,sha256,role}]');
        });
    }

    public function down(): void
    {
        Schema::table('build_requests', function (Blueprint $table) {
            $table->dropColumn('artifact_files');
        });
    }
};
