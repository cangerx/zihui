<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 直充快捷档位（充 X 送 Y 的预设档）。
 * 自由金额按比例充值的配置存 system_settings（recharge_* 键）。
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('recharge_packages')) {
            Schema::create('recharge_packages', function (Blueprint $table) {
                $table->id();
                $table->string('balance_type', 20)->default('credit'); // token=金币 | credit=积分
                $table->decimal('pay_amount', 16, 2)->default(0);       // 支付金额（元）
                $table->decimal('base_amount', 16, 4)->default(0);      // 基础到账
                $table->decimal('bonus_amount', 16, 4)->default(0);     // 赠送
                $table->string('title', 100)->default('');
                $table->string('status', 20)->default('active');       // active | disabled
                $table->unsignedInteger('sort')->default(0);
                $table->timestamps();

                $table->index(['balance_type', 'status', 'sort']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('recharge_packages');
    }
};
