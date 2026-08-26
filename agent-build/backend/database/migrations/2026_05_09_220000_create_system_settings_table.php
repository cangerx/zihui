<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    /**
     * key-value 系统配置表。
     *
     * 设计：
     *  - (group_key, setting_key) 唯一，避免重复
     *  - is_encrypted = 1 时 setting_value 存的是 Crypt::encryptString(...) 的密文
     *  - 用 group_key 区分模块（cos / build_quota / future...），无业务耦合
     */
    public function up(): void
    {
        Schema::create('system_settings', function (Blueprint $table) {
            $table->id();
            $table->string('group_key', 64)->comment('配置分组，例如 cos / build');
            $table->string('setting_key', 128)->comment('配置项名');
            $table->text('setting_value')->nullable()->comment('值，敏感字段加密后写入');
            $table->boolean('is_encrypted')->default(false)->comment('是否经 Crypt 加密');
            $table->string('description', 255)->nullable();
            $table->timestamps();
            $table->unique(['group_key', 'setting_key'], 'uniq_group_setting_key');
            $table->index('group_key', 'idx_group_key');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('system_settings');
    }
};
