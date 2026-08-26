<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('username', 50)->unique();
            $table->string('email', 100)->unique()->nullable();
            $table->string('password');
            $table->string('phone', 20)->nullable();
            $table->string('nickname', 50)->default('');
            $table->enum('role', ['admin', 'user'])->default('user');
            $table->enum('status', ['active', 'disabled'])->default('active');
            $table->string('remark', 500)->default('');
            $table->timestamps();

            $table->index('status');
            $table->index('role');
        });
    }

    public function down()
    {
        Schema::dropIfExists('users');
    }
};
