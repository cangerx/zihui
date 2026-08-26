<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up()
    {
        Schema::create('system_settings', function (Blueprint $table) {
            $table->id();
            $table->string('key', 100)->unique();
            $table->text('value')->nullable();
            $table->string('remark', 200)->default('');
            $table->timestamps();
        });

        // Seed default keys
        $now = now();
        $defaults = [
            ['key' => 'register_bonus_enabled', 'value' => '0',    'remark' => '注册赠送开关'],
            ['key' => 'register_bonus_token',   'value' => '0',    'remark' => '注册赠送余额（token）'],
            ['key' => 'register_bonus_credit',  'value' => '0',    'remark' => '注册赠送积分（credit）'],
            ['key' => 'register_bonus_plan_id', 'value' => '',     'remark' => '注册赠送套餐 ID（为空则不赠送套餐）'],
            ['key' => 'register_bonus_remark',  'value' => '新用户注册赠送', 'remark' => '赠送日志备注'],
            ['key' => 'register_ip_daily_limit','value' => '10',   'remark' => '同 IP 每日可领奖次数'],
            ['key' => 'register_device_unique', 'value' => '1',    'remark' => '同设备 ID 仅允许领奖一次'],
        ];
        foreach ($defaults as $row) {
            DB::table('system_settings')->insert(array_merge($row, [
                'created_at' => $now,
                'updated_at' => $now,
            ]));
        }
    }

    public function down()
    {
        Schema::dropIfExists('system_settings');
    }
};
