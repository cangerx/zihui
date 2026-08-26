<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * 为桌面端注册页协议（注册协议 / 隐私协议）注入默认占位文案。
 *
 * 仅当 key 尚未存在时写入，已有运维填写的内容不会被覆盖。
 * 表结构本身在 2026_05_03_000001_create_system_settings_table.php 创建。
 */
return new class extends Migration
{
    public function up()
    {
        $now = now();

        $defaults = [
            'register_agreement_title' => '注册协议',
            'register_agreement_content' => '<h3>注册协议</h3>'
                . '<p>感谢您选择使用本服务。在注册账号前，请您仔细阅读本协议的全部内容。注册即表示您已知悉并同意以下条款：</p>'
                . '<ol>'
                . '<li>您应当如实填写注册信息，并对所提交内容的真实性、准确性负责。</li>'
                . '<li>您应妥善保管账号与密码，不得将账号借予他人使用或与他人共享。</li>'
                . '<li>您承诺不利用本服务从事违反法律法规或损害他人合法权益的活动。</li>'
                . '<li>本服务的具体功能、计费规则、增值服务以页面实际展示为准，平台保留调整的权利。</li>'
                . '</ol>'
                . '<p>本占位文案由管理员在系统设置中替换为正式条款后生效。</p>',
            'privacy_agreement_title' => '隐私协议',
            'privacy_agreement_content' => '<h3>隐私协议</h3>'
                . '<p>我们高度重视您的个人信息保护。本协议说明我们如何收集、使用、存储与保护您的数据：</p>'
                . '<ol>'
                . '<li>注册账号时，我们仅收集为提供服务所必需的最少信息（如用户名、密码、可选的昵称与手机号）。</li>'
                . '<li>您在本服务中创建的对话、生成的图片等内容默认保存在您本地设备，云端仅保存账户与计费等必要数据。</li>'
                . '<li>我们采用合理的技术与管理措施保护您的数据安全，未经您同意不会向任何第三方披露。</li>'
                . '<li>您可以随时通过设置导出或删除本地数据，相关云端数据可向客服申请删除。</li>'
                . '</ol>'
                . '<p>本占位文案由管理员在系统设置中替换为正式条款后生效。</p>',
        ];

        foreach ($defaults as $key => $value) {
            $exists = DB::table('system_settings')->where('key', $key)->exists();
            if ($exists) continue;
            DB::table('system_settings')->insert([
                'key' => $key,
                'value' => $value,
                'remark' => '桌面端注册页协议（HTML，由管理员编辑）',
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    public function down()
    {
        DB::table('system_settings')->whereIn('key', [
            'register_agreement_title',
            'register_agreement_content',
            'privacy_agreement_title',
            'privacy_agreement_content',
        ])->delete();
    }
};
