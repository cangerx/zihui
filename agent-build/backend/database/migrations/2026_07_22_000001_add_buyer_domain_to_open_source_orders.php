<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 开源交付订单表增加「已授权域名」列。
 *
 * 先锋开源面向已获授权的用户，购买时登记其原授权域名（buyer_domain），供运营人工核对授权与交付。
 *
 * 铁律：只用 Schema:: 原生 API，不 import 业务 Model；只增不改已发布迁移。
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('open_source_orders')) {
            return;
        }
        if (Schema::hasColumn('open_source_orders', 'buyer_domain')) {
            return;
        }
        Schema::table('open_source_orders', function (Blueprint $table) {
            // 购买人登记的已授权域名（先锋开源用；免费档不下单不涉及）。
            $table->string('buyer_domain', 255)->nullable()->after('buyer_email');
        });
    }

    public function down(): void
    {
        if (Schema::hasTable('open_source_orders') && Schema::hasColumn('open_source_orders', 'buyer_domain')) {
            Schema::table('open_source_orders', function (Blueprint $table) {
                $table->dropColumn('buyer_domain');
            });
        }
    }
};
