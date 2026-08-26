<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    /**
     * 0.4.0：新增 build_requests.cos_object_prefix
     *
     * 用途：
     *  - GitHub Actions workflow 在 COS 上传步骤完成后通过 callback 回传
     *  - BuildCallbackController 强校验后落库
     *  - BuildRequestController::serveDownload 据此现场签 GET URL，302 redirect 给云控端
     *
     * 当此字段非空 → 走 COS 直拉路径，BuildWorker 不再下载本地副本
     * 此字段为空 → 走旧的 GitHub artifact 流程（BuildWorker 拉到本地，sendDownload 流式输出）
     */
    public function up(): void
    {
        Schema::table('build_requests', function (Blueprint $table) {
            $table->string('cos_object_prefix', 255)
                ->nullable()
                ->after('artifact_files')
                ->comment('COS 对象前缀，例 build-artifacts/{build_id}/');
        });
    }

    public function down(): void
    {
        Schema::table('build_requests', function (Blueprint $table) {
            $table->dropColumn('cos_object_prefix');
        });
    }
};
