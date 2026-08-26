<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('user_groups')) {
            return;
        }

        $defaultIds = DB::table('user_groups')
            ->where('is_default', true)
            ->orderBy('id')
            ->pluck('id')
            ->values();

        if ($defaultIds->count() <= 1) {
            return;
        }

        DB::table('user_groups')
            ->whereIn('id', $defaultIds->slice(1)->all())
            ->update(['is_default' => false]);
    }

    public function down(): void
    {
    }
};
