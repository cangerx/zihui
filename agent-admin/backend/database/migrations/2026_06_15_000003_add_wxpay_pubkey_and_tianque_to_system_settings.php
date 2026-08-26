<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * 1.2.8：seed 微信支付公钥模式 + 天阙聚合支付的默认配置行。
 *
 * 与 2026_06_01_000002_add_wxpay_keys_to_system_settings 同样的 insertOrIgnore 模式：
 *   - 已存在的 key 不动（向后兼容）
 *   - 新装站点 / 老站点升级到 1.2.8 都会确保表里有完整字段，便于运维直接查表
 */
return new class extends Migration
{
    public function up()
    {
        $now = now();
        $defaults = [
            // 微信支付公钥模式（推荐，永不轮换；与平台证书模式自动二选一）
            ['key' => 'wxpay_pub_key_id', 'value' => '', 'remark' => '微信支付公钥 ID（PUB_KEY_ID_xxx）'],
            ['key' => 'wxpay_pub_key',    'value' => '', 'remark' => '微信支付公钥 PEM'],
            // 天阙聚合支付（一通道支持微信/支付宝/云闪付/数字人民币）
            ['key' => 'tianque_enabled',     'value' => '0',    'remark' => '天阙聚合支付总开关'],
            ['key' => 'tianque_env',         'value' => 'test', 'remark' => '天阙环境：test / prod'],
            ['key' => 'tianque_version',     'value' => '1.2',  'remark' => '天阙身份类型：1.2 商户 / 1.0 服务商'],
            ['key' => 'tianque_org_id',      'value' => '',     'remark' => '天阙机构号（8 或 10 位数字）'],
            ['key' => 'tianque_mno',         'value' => '',     'remark' => '天阙商户号（399 开头 15 位数字）'],
            ['key' => 'tianque_private_key', 'value' => '',     'remark' => '天阙商户 PKCS8 私钥 PEM（加密存储）'],
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
            'wxpay_pub_key_id',
            'wxpay_pub_key',
            'tianque_enabled',
            'tianque_env',
            'tianque_version',
            'tianque_org_id',
            'tianque_mno',
            'tianque_private_key',
        ])->delete();
    }
};
