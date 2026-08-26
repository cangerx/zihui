<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up()
    {
        $exists = DB::table('system_settings')->where('key', 'register_enabled')->exists();
        if ($exists) return;

        $now = now();
        DB::table('system_settings')->insert([
            'key' => 'register_enabled',
            'value' => '1',
            'remark' => '是否允许桌面端新用户注册',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    public function down()
    {
        DB::table('system_settings')->where('key', 'register_enabled')->delete();
    }
};
