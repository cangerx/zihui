<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 开源交付 —— 订单表。
 *
 * 用于授权管理端的「开源交付」独立公开页：用户选择「先锋开源」档 → 填写购买人信息
 * （姓名/电话/微信号/邮箱）→ 微信扫码付款 → 回调标记已支付。交付（拉群 / 发代码包 /
 * 发规则文档）由运营在后台看到订单后人工完成，本表不做自动开通。
 *
 * 免费档（8 月底面向所有人公开，仅桌面端一次性）不走本表，无需下单。
 *
 * 铁律（在线更新依赖）：只用 Schema:: 原生 API，不 import 业务 Model；已发布后永不修改/删除。
 */
return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('open_source_orders')) {
            return;
        }

        Schema::create('open_source_orders', function (Blueprint $table) {
            $table->bigIncrements('id');

            // 商户订单号：带 OPEN 前缀，与商城授权单（MALL）/ 云控端充值单天然不冲突。
            $table->string('order_no', 40)->unique();

            // 交付档位：当前仅 pioneer（先锋开源，付费）。free 档不下单，不入本表。
            $table->string('tier', 24)->default('pioneer');

            // 购买人信息（收款前必填，用于人工交付：拉群 / 发包 / 发文档）。
            $table->string('buyer_name', 60);
            $table->string('buyer_phone', 40);
            $table->string('buyer_wechat', 80);
            $table->string('buyer_email', 120);

            // 金额（元）。校验时 ×100 转分与微信比对。
            $table->decimal('amount', 10, 2);
            $table->string('currency', 8)->default('CNY');

            // 状态机：pending → paid / closed / failed。
            $table->string('status', 16)->default('pending');
            // 支付渠道（当前仅微信 Native 扫码）。
            $table->string('channel', 32)->default('wechat_native');

            // 微信下单返回的二维码内容 + 交易号；回调原始报文留证。
            $table->text('code_url')->nullable();
            $table->string('wx_transaction_id', 64)->nullable();
            $table->longText('notify_payload')->nullable();

            // 交付跟踪：运营完成交付后可标记（本期仅存储，管理页展示/勾选）。
            $table->boolean('delivered')->default(false);
            $table->dateTime('delivered_at')->nullable();

            $table->string('client_ip', 45)->nullable();
            $table->string('remark', 255)->nullable();

            $table->dateTime('expires_at');
            $table->dateTime('paid_at')->nullable();
            $table->dateTime('closed_at')->nullable();
            $table->timestamps();

            $table->index(['status', 'expires_at'], 'idx_oso_status_expires');
            $table->index('buyer_email', 'idx_oso_email');
            $table->index('created_at', 'idx_oso_created');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('open_source_orders');
    }
};
