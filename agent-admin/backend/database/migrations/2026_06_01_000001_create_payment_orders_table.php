<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        Schema::create('payment_orders', function (Blueprint $table) {
            $table->id();
            $table->string('order_no', 40)->unique();
            $table->unsignedBigInteger('user_id');
            $table->unsignedBigInteger('plan_id');
            $table->text('plan_snapshot');                          // JSON 套餐快照
            $table->decimal('amount', 16, 2);                       // 订单金额（元）
            $table->string('currency', 10)->default('CNY');
            $table->string('channel', 20)->default('wechat_native');
            $table->string('status', 20)->default('pending');       // pending|paid|closed|failed|refunded
            $table->string('wx_prepay_id', 64)->nullable();
            $table->string('wx_transaction_id', 64)->nullable();
            $table->string('code_url', 500)->nullable();
            $table->text('notify_payload')->nullable();
            $table->unsignedBigInteger('user_plan_id')->nullable();
            $table->timestamp('paid_at')->nullable();
            $table->timestamp('closed_at')->nullable();
            $table->timestamp('expires_at');
            $table->decimal('refund_amount', 16, 2)->nullable();    // 预留退款字段
            $table->timestamp('refund_at')->nullable();
            $table->string('refund_reason', 500)->default('');
            $table->string('wx_refund_id', 64)->nullable();
            $table->string('remark', 500)->default('');
            $table->string('client_ip', 45)->default('');
            $table->timestamps();

            $table->index(['user_id', 'status']);
            $table->index(['user_id', 'plan_id', 'status']);
            $table->index(['status', 'expires_at']);
            $table->index('wx_transaction_id');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
        });
    }

    public function down()
    {
        Schema::dropIfExists('payment_orders');
    }
};
