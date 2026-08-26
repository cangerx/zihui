<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 去AI标记用量/扣费记录表。
 *
 * 「去AI标记」是桌面端本地处理（剥离元数据/溯源标识），但按次计费，
 * 处理成功后由桌面端回调 /gateway/watermark-removal/charge 扣费并写一条记录。
 * request_id 唯一索引承担幂等：同一次处理重试不会重复扣费。
 *
 * 说明：不复用 usage_records（其 type 为 enum[chat/image/embedding]、
 * cloud_model_id 非空且外键约束 cloud_models），故独立成表，与抠图 matting_tasks 同思路。
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('ai_mark_removal_records')) {
            return;
        }

        Schema::create('ai_mark_removal_records', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id');
            // 本次扣费积分（免费用户为 0）
            $table->decimal('cost', 10, 4)->default(0);
            // 扣费钱包类型（当前固定 credit，预留扩展）
            $table->string('balance_type', 20)->default('credit');
            // 命中的标记类型，逗号分隔（如 c2pa,exif,xmp,aigc,png_text）
            $table->string('marks', 500)->default('');
            // 本次处理图片数（单次可批量）
            $table->unsignedInteger('image_count')->default(1);
            $table->string('status', 20)->default('success');
            // 幂等键：桌面端生成的 uuid，同一次处理重试只扣一次
            $table->string('request_id', 100)->default('');
            $table->timestamps();

            $table->unique('request_id');
            $table->index(['user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_mark_removal_records');
    }
};
