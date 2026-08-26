<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class AdminUserSeeder extends Seeder
{
    public function run(): void
    {
        $now = now();
        DB::table('admin_users')->updateOrInsert(
            ['username' => 'admin'],
            [
                'username' => 'admin',
                'password_hash' => Hash::make('admin123'),
                'name' => 'Default Admin',
                'role' => 'admin',
                'is_active' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ]
        );
    }
}
