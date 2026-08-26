<?php

namespace Database\Seeders;

use App\Models\User;
use App\Models\UserBalance;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    public function run()
    {
        // Create default admin
        $admin = User::firstOrCreate(
            ['username' => 'admin'],
            [
                'password' => Hash::make('admin123'),
                'email' => 'admin@example.com',
                'nickname' => 'Administrator',
                'role' => 'admin',
                'status' => 'active',
            ]
        );

        UserBalance::firstOrCreate(
            ['user_id' => $admin->id, 'balance_type' => 'token'],
            ['amount' => 0]
        );
        UserBalance::firstOrCreate(
            ['user_id' => $admin->id, 'balance_type' => 'credit'],
            ['amount' => 0]
        );

        // 内置行业话术包（minimal 模板：通用版 + 广告/营销版）
        // firstOrCreate 策略：已存在则跳过，不覆盖用户改动
        $this->call(HomepagePhrasePackSeeder::class);
    }
}
