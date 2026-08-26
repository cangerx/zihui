<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 精细抠图（抠抠图 koukoutu 异步 API）后端基础设施。
 *
 * 设计原则（与 AI 抠图 matting_tasks 一致的自治体系）：
 *   1. 凭证 / 三档计费 / 启用开关都存 SystemSetting (fine_matting_*)，由管理后台
 *      「精细抠图 → 自定义设置」配置；不走 .env、不走 cloud_providers / billing_rules。
 *   2. fine_matting_tasks 表自治计量，独立于 matting_tasks 与 image_tasks。
 *   3. 按上传图片长边尺寸三档积分计费：width/height/tier/cost 入库，便于审计与统计。
 *
 * 回滚：删 fine_matting_tasks 表。
 */
return new class extends Migration {

    public function up(): void
    {
        if (!Schema::hasTable('fine_matting_tasks')) {
            Schema::create('fine_matting_tasks', function (Blueprint $table) {
                $table->string('id', 36)->primary();
                $table->unsignedBigInteger('user_id')->index();

                // 输入源：upload（multipart image_file，精细抠图固定走此模式）；url 预留
                $table->enum('source', ['upload', 'url'])->default('upload');

                // 输入元数据（文件名 / 大小 / 格式 / 宽高）
                $table->json('request_meta')->nullable();

                $table->enum('status', ['pending', 'processing', 'completed', 'failed'])
                    ->default('pending')->index();

                // 结果：image_url（抠抠图结果 URL）/ request_id / elapsed_ms / provider_task_id
                $table->json('result')->nullable();
                $table->text('error')->nullable();

                // 三档计费：原图长边像素决定 tier(1/2/3)，cost 为本系统积分扣费
                $table->unsignedInteger('width')->default(0);
                $table->unsignedInteger('height')->default(0);
                $table->unsignedTinyInteger('tier')->default(0);
                $table->decimal('cost', 16, 6)->default(0);

                // 抠抠图返回的任务 ID（provider 侧 trace）
                $table->string('provider_task_id', 64)->nullable();

                // 我们端 UUID，用于 trace
                $table->string('request_id', 36);
                $table->timestamps();

                $table->index(['status', 'created_at']);
                $table->index(['user_id', 'created_at']);

                // 不加 user_id 外键（保留历史任务，即使用户删除）
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('fine_matting_tasks');
    }
};
