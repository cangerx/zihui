<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * 为 users.phone 增加唯一索引，支撑「手机号 + 验证码」注册与找回密码（需手机号能唯一定位用户）。
 *
 * 加索引前先做历史脏数据清洗：
 *  1) 空串 / 旧默认值统一转 NULL —— MySQL 唯一索引允许多个 NULL，但只允许一个空串；
 *     历史注册曾把未填手机写成 ''（见旧版 AuthController），不清洗会导致建索引失败。
 *  2) 重复的非空手机号 —— 保留 id 最小者，其余置 NULL（这些账号需重新绑定手机号才能用短信找回）。
 */
return new class extends Migration
{
    public function up(): void
    {
        // 1) 空串手机号统一转 NULL
        DB::statement("UPDATE users SET phone = NULL WHERE phone = '' OR phone IS NULL");

        // 2) 重复非空手机号：每组保留最小 id，其余置 NULL。
        // 使用 Query Builder 避免 MySQL 专属 UPDATE ... JOIN，确保 SQLite /
        // PostgreSQL 也能完成同样的数据清洗。
        $duplicates = DB::table('users')
            ->select('phone', DB::raw('MIN(id) AS keep_id'))
            ->whereNotNull('phone')
            ->where('phone', '<>', '')
            ->groupBy('phone')
            ->havingRaw('COUNT(*) > 1')
            ->get();

        foreach ($duplicates as $duplicate) {
            DB::table('users')
                ->where('phone', $duplicate->phone)
                ->where('id', '<>', $duplicate->keep_id)
                ->update(['phone' => null]);
        }

        // 3) 加唯一索引（允许多个 NULL，未绑定手机号的历史用户不受影响）
        Schema::table('users', function (Blueprint $table) {
            $table->unique('phone', 'users_phone_unique');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique('users_phone_unique');
        });
    }
};
