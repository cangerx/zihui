<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('inspirations', function (Blueprint $table) {
            $table->unsignedBigInteger('uploader_user_id')->nullable()->after('category_id');
            $table->string('uploader_nickname', 50)->default('')->after('uploader_user_id');

            $table->foreign('uploader_user_id')
                  ->references('id')
                  ->on('users')
                  ->onDelete('set null');
            $table->index('uploader_user_id');
        });
    }

    public function down(): void
    {
        Schema::table('inspirations', function (Blueprint $table) {
            $table->dropForeign(['uploader_user_id']);
            $table->dropIndex(['uploader_user_id']);
            $table->dropColumn(['uploader_user_id', 'uploader_nickname']);
        });
    }
};
