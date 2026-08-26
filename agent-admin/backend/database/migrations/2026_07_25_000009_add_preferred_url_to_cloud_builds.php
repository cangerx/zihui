<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('cloud_builds', function (Blueprint $table) {
            // 家庭电脑直连下载的「优选」URL（http://公网IP:893/...）。
            // 由 agent-build download 接口的 primary.preferred_url 透传而来；下载时「直连优先、
            // CDN(agent_build_url) 兜底」。可空：未开启直连特性 / 家庭电脑失联时为 NULL，纯走 CDN。
            $table->string('agent_build_preferred_url', 500)
                ->nullable()
                ->after('agent_build_url')
                ->comment('家庭电脑直连优选下载URL，失败回退 agent_build_url(CDN)');
        });
    }

    public function down(): void
    {
        Schema::table('cloud_builds', function (Blueprint $table) {
            $table->dropColumn('agent_build_preferred_url');
        });
    }
};
