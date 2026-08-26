<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('video_pricing_rules')) {
            DB::table('video_pricing_rules')->where('target_type', 'default')->delete();
        }
    }

    public function down(): void
    {
    }
};
