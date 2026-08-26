<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('agents', function (Blueprint $table) {
            $table->unsignedInteger('template_schema_version')->default(1)->after('system_prompt');
            $table->unsignedInteger('template_version')->default(1)->after('template_schema_version');
            $table->json('role_profile')->nullable()->after('template_version');
            $table->json('workflow_templates')->nullable()->after('role_profile');
            $table->json('acceptance_templates')->nullable()->after('workflow_templates');
            $table->json('recommended_skill_dirs')->nullable()->after('acceptance_templates');
            $table->json('connector_requirements')->nullable()->after('recommended_skill_dirs');
        });
    }

    public function down(): void
    {
        Schema::table('agents', function (Blueprint $table) {
            $table->dropColumn([
                'template_schema_version',
                'template_version',
                'role_profile',
                'workflow_templates',
                'acceptance_templates',
                'recommended_skill_dirs',
                'connector_requirements',
            ]);
        });
    }
};
