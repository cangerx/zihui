<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('agents', function (Blueprint $table) {
            // 定价：price=0 表示免费；>0 时桌面端「保存到本地」需按 price_balance_type 扣费购买
            $table->decimal('price', 12, 2)->default(0)->after('tags');
            // 计价币种：token=金币 / credit=积分（复用现有 user_balances 的 balance_type）
            $table->string('price_balance_type', 20)->default('credit')->after('price');
            // 可见范围：public 全员可见 / restricted 仅指定用户/用户组可见（白名单在 agent_visibilities）
            $table->string('visibility_scope', 20)->default('public')->after('is_visible');

            $table->index('visibility_scope');
        });
    }

    public function down(): void
    {
        Schema::table('agents', function (Blueprint $table) {
            $table->dropIndex(['visibility_scope']);
            $table->dropColumn(['price', 'price_balance_type', 'visibility_scope']);
        });
    }
};
