<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        Schema::table('usage_records', function (Blueprint $table) {
            $table->enum('balance_type', ['token', 'credit'])->default('token')->after('cost');
        });

        // Backfill: image type with credits_used > 0 => credit
        DB::table('usage_records')
            ->where('type', 'image')
            ->where('credits_used', '>', 0)
            ->update(['balance_type' => 'credit']);
    }

    public function down()
    {
        Schema::table('usage_records', function (Blueprint $table) {
            $table->dropColumn('balance_type');
        });
    }
};
