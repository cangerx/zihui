<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('homepage_images', function (Blueprint $table) {
            $table->id();
            // 位置标识，对应首页 data-img-pos 值
            $table->string('position', 64)->unique();
            // 图片访问 URL（相对路径或绝对 URL 都可）
            $table->string('image_url', 500);
            // 原始文件名，便于管理查看
            $table->string('filename', 255)->nullable();
            // 图片字节大小
            $table->unsignedBigInteger('size')->nullable();
            $table->unsignedInteger('width')->nullable();
            $table->unsignedInteger('height')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('homepage_images');
    }
};
