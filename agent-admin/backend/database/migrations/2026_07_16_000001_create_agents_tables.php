<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 智能体市场：云控端创建 / 桌面端投稿，桌面端拉取后「保存到本地」生成本地 bot。
        // 工具绑定只承载跨机器固定可用的「6 个内置小工具」ID（builtin_*），不携带用户自建小工具 / MCP / 知识库。
        Schema::create('agents', function (Blueprint $table) {
            $table->id();
            $table->string('name', 100);
            $table->string('description', 500)->default('');
            // 2:3 形象图（StorageService 返回的 URL：local 相对路径 / cos / oss）
            $table->string('avatar', 500)->default('');
            // 系统提示词（决定智能体行为；桌面端导入时据此自动建「人格」）
            $table->longText('system_prompt')->nullable();
            // 绑定的内置小工具 ID 数组（builtin_*），默认 6 个全绑
            $table->json('tool_skill_ids')->nullable();
            // 工具调用确认：off / destructive / all
            $table->string('tool_approval', 20)->default('destructive');
            // 是否开启生图能力
            $table->boolean('enable_image_gen')->default(false);
            // 标签
            $table->json('tags')->nullable();
            // 下载量（桌面端保存到本地时 +1）
            $table->unsignedInteger('download_count')->default(0);
            // 评分聚合（agent_ratings 重算写入）
            $table->decimal('rating_avg', 3, 2)->default(0);
            $table->unsignedInteger('rating_count')->default(0);
            // 排序
            $table->unsignedInteger('sort_order')->default(0);
            // 上架/下架（= 启用/停用）
            $table->boolean('is_visible')->default(true);
            // 审核态：pending / approved / rejected / withdrawn（管理员直建默认 approved）
            $table->string('submission_status', 20)->default('approved');
            // 来源：admin（管理员创建）/ user（桌面端投稿）
            $table->string('source_type', 20)->default('admin');
            // 投稿人（user 来源）
            $table->unsignedBigInteger('submitted_by_user_id')->nullable();
            $table->string('submitted_by_nickname', 100)->default('');
            // 审核人
            $table->unsignedBigInteger('reviewed_by_user_id')->nullable();
            $table->timestamp('reviewed_at')->nullable();
            $table->string('reject_reason', 500)->default('');
            // 投稿对应的桌面端本地 bot id（用于状态轮询去重）
            $table->string('source_local_agent_id', 100)->default('');
            $table->timestamp('submitted_at')->nullable();
            $table->timestamp('published_at')->nullable();
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->timestamps();

            $table->index(['is_visible', 'submission_status']);
            $table->index(['sort_order', 'id']);
            $table->index(['submitted_by_user_id', 'source_local_agent_id']);
        });

        // 评分（一人一评，可改分）；提交后事务内重算 agents.rating_avg / rating_count
        Schema::create('agent_ratings', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('agent_id');
            $table->unsignedBigInteger('user_id');
            $table->unsignedTinyInteger('score'); // 1..5
            $table->string('comment', 500)->nullable();
            $table->timestamps();

            $table->unique(['agent_id', 'user_id']);
            $table->index('agent_id');

            $table->foreign('agent_id')
                ->references('id')
                ->on('agents')
                ->onDelete('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('agent_ratings');
        Schema::dropIfExists('agents');
    }
};
