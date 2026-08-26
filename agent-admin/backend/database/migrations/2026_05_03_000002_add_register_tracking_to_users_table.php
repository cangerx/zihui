<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('register_ip', 45)->nullable()->after('remark');
            $table->string('register_device_id', 64)->nullable()->after('register_ip');
            $table->index('register_device_id');
            $table->index('register_ip');
        });
    }

    public function down()
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropIndex(['register_device_id']);
            $table->dropIndex(['register_ip']);
            $table->dropColumn(['register_ip', 'register_device_id']);
        });
    }
};
