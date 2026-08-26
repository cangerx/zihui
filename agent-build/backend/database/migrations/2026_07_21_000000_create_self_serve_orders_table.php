<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 自助付费开通商城授权 —— 订单表。
 *
 * 用于授权管理端的「独立自助付费页」：用户输入域名 → 勾选未授权商城 → 微信扫码付款 →
 * 回调成功后按本表记录的 client_id + mall_keys 自动写 client_mall_authorizations 授权位。
 *
 * 铁律（在线更新依赖）：只用 Schema:: 原生 API，不 import 业务 Model；已发布后永不修改/删除。
 */
return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('self_serve_orders')) {
            return;
        }

        Schema::create('self_serve_orders', function (Blueprint $table) {
            $table->bigIncrements('id');

            // 商户订单号：带 MALL 前缀，与云控端自身充值订单号天然不冲突（复用同一微信商户号时关键）。
            $table->string('order_no', 40)->unique();

            // 下单时锁定的归属：domain 是对外身份键，client_id 是 authorized_clients 内部主键。
            $table->string('client_id', 64)->nullable()->index();
            $table->string('domain', 255);

            // 本单要开通的商城：JSON 数组，如 ["dianda","qdyun"]。回调据此逐个写授权位。
            $table->json('mall_keys');

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

            $table->string('client_ip', 45)->nullable();
            $table->string('remark', 255)->nullable();

            $table->dateTime('expires_at');
            $table->dateTime('paid_at')->nullable();
            $table->dateTime('closed_at')->nullable();
            $table->timestamps();

            $table->index(['status', 'expires_at'], 'idx_sso_status_expires');
            $table->index('created_at', 'idx_sso_created');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('self_serve_orders');
    }
};
