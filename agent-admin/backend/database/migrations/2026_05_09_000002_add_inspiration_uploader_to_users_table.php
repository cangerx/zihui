<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('inspiration_uploader')->default(false)->after('remark');
            $table->index('inspiration_uploader');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropIndex(['inspiration_uploader']);
            $table->dropColumn('inspiration_uploader');
        });
    }
};
