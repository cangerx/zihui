<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('authorized_clients', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';

            $table->bigIncrements('id');
            $table->string('client_id', 32)->unique()->comment('公开标识');
            $table->string('client_secret', 255)->comment('bcrypt hash');
            $table->string('domain', 255)->unique()->comment('云控端域名（强绑定）');
            $table->string('api_domain', 255)->nullable()->comment('软件 API 域名，默认= domain');
            $table->string('notify_url', 500)->comment('云控端被通知接口完整 URL');
            $table->string('owner_name', 100);
            $table->string('contact', 255)->nullable();
            $table->integer('daily_limit')->default(3)->comment('日打包总次数（不分平台）');
            $table->integer('monthly_limit')->default(30);
            $table->enum('status', ['active', 'suspended', 'expired'])->default('active');
            $table->dateTime('expires_at')->nullable();
            $table->dateTime('created_at');
            $table->dateTime('updated_at');

            $table->index('status', 'idx_status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('authorized_clients');
    }
};
