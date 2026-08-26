<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * AI 抠图（阿里云 viapi SegmentHDCommonImage）后端基础设施。
 *
 * 设计原则（v1.5.0 重构）：
 *   1. 抠图走独立轻量体系：凭证 / 计费 / 启用开关都存 SystemSetting 表 (matting_*)，由管理后台
 *      「AI 抠图 → 自定义设置」tab 错（不再后端 .env，也不再 seed 「阿里云 viapi(抠图)」服务商 进 cloud_providers）。
 *   2. matting_tasks 表自治计量（任务补录独立），不再复用 cloud_models / billing_rules / usage_records 体系。
 *   3. 不再扩 cloud_models.type / usage_records.type 的 ENUM（避免动现有表结构 + ENUM 缩回会踩无法回滚的坑）。
 *
 * 字段变更：
 *   - 新建 matting_tasks 表（不含 cloud_model_id，完全独立）
 *
 * 回滚：删 matting_tasks 表。
 */
return new class extends Migration {

    public function up(): void
    {
        if (!Schema::hasTable('matting_tasks')) {
            Schema::create('matting_tasks', function (Blueprint $table) {
                $table->string('id', 36)->primary();
                $table->unsignedBigInteger('user_id')->index();

                // 输入源：upload（multipart 上传） / url（客户端传公网 URL）
                $table->enum('source', ['upload', 'url'])->default('upload');

                // 输入元数据（剥 base64 后入库；尺寸/大小/格式）
                $table->json('request_meta')->nullable();

                $table->enum('status', ['pending', 'processing', 'completed', 'failed'])
                    ->default('pending')->index();

                // 结果：image_url / aliyun_request_id / elapsed_ms。
                // 阿里临时 URL 24h 有效，客户端拿到后需立刻下载。
                $table->json('result')->nullable();
                $table->text('error')->nullable();
                // 抠图单次扣费（积分），从 SystemSetting matting_credit_per_call 读。
                $table->decimal('cost', 16, 6)->default(0);
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
        Schema::dropIfExists('matting_tasks');
    }
};
