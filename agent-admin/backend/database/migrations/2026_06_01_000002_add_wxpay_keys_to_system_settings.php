<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up()
    {
        $now = now();
        $defaults = [
            ['key' => 'wxpay_enabled',         'value' => '0',  'remark' => '微信支付总开关'],
            ['key' => 'wxpay_mchid',           'value' => '',   'remark' => '微信商户号'],
            ['key' => 'wxpay_app_id',          'value' => '',   'remark' => '微信 AppID'],
            ['key' => 'wxpay_apiv3_key',       'value' => '',   'remark' => '微信 APIv3 密钥（加密存储）'],
            ['key' => 'wxpay_cert_serial_no',  'value' => '',   'remark' => '商户证书序列号'],
            ['key' => 'wxpay_private_key',     'value' => '',   'remark' => '商户 API 私钥 PEM（加密存储）'],
            ['key' => 'wxpay_platform_cert',   'value' => '',   'remark' => '微信平台证书 PEM'],
        ];
        foreach ($defaults as $row) {
            DB::table('system_settings')->insertOrIgnore(array_merge($row, [
                'created_at' => $now,
                'updated_at' => $now,
            ]));
        }
    }

    public function down()
    {
        DB::table('system_settings')->whereIn('key', [
            'wxpay_enabled',
            'wxpay_mchid',
            'wxpay_app_id',
            'wxpay_apiv3_key',
            'wxpay_cert_serial_no',
            'wxpay_private_key',
            'wxpay_platform_cert',
        ])->delete();
    }
};
