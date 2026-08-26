<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('app_assets') || Schema::hasColumn('app_assets', 'idempotency_hash')) {
            return;
        }
        Schema::table('app_assets', function (Blueprint $table) {
            $table->char('idempotency_hash', 64)->nullable()->after('nonce_hash');
            $table->unique(['user_id', 'idempotency_hash']);
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('app_assets') || !Schema::hasColumn('app_assets', 'idempotency_hash')) {
            return;
        }
        Schema::table('app_assets', function (Blueprint $table) {
            $table->dropUnique('app_assets_user_id_idempotency_hash_unique');
            $table->dropColumn('idempotency_hash');
        });
    }
};
