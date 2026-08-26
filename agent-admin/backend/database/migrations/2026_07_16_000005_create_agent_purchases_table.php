<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 智能体购买/拥有凭证：服务端为准，独立于桌面端本地 bot。
        // 删除本地 bot 后重新「保存到本地」凭此免重复扣费。
        Schema::create('agent_purchases', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('agent_id');
            $table->unsignedBigInteger('user_id');
            $table->decimal('price', 12, 2)->default(0);   // 购买时价格快照
            $table->string('balance_type', 20)->default('credit');
            $table->timestamp('purchased_at')->nullable();
            $table->timestamps();

            $table->unique(['agent_id', 'user_id']);
            $table->index('user_id');

            $table->foreign('agent_id')->references('id')->on('agents')->onDelete('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('agent_purchases');
    }
};
