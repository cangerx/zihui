<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 自助开通云控打包授权订单。与 self_serve_orders（商城授权）分表。
 */
return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('packaging_license_orders')) {
            return;
        }

        Schema::create('packaging_license_orders', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('order_no', 40)->unique();
            $table->string('client_id', 64)->nullable()->index();
            $table->string('domain', 255);
            $table->json('features');
            $table->decimal('amount', 10, 2);
            $table->string('currency', 8)->default('CNY');
            $table->string('status', 16)->default('pending');
            $table->string('channel', 32)->default('wechat_native');
            $table->text('code_url')->nullable();
            $table->string('wx_transaction_id', 64)->nullable();
            $table->longText('notify_payload')->nullable();
            $table->string('client_ip', 45)->nullable();
            $table->string('remark', 255)->nullable();
            $table->dateTime('expires_at');
            $table->dateTime('paid_at')->nullable();
            $table->dateTime('closed_at')->nullable();
            $table->timestamps();

            $table->index(['status', 'expires_at'], 'idx_plo_status_expires');
            $table->index('created_at', 'idx_plo_created');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('packaging_license_orders');
    }
};
