<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 创建 Laravel Queue 内置 jobs / failed_jobs 表。
 *
 * 用途：QUEUE_CONNECTION=database 时，dispatch 任务进 jobs 表，
 * 由 `php artisan queue:work database` worker 进程拉取并执行。
 *
 * 默认 QUEUE_CONNECTION=sync 下不会用到这两张表（走 terminating 兼容路径），但
 * 仍然无条件建表，让用户随时可以切 database driver 而不用补 migration。
 *
 * 切到 database driver 后相比 sync 兼容路径的优势：
 *   - 真异步：worker 独立进程，不阻塞 / 不寄生 web 响应
 *   - 失败重试：tries / backoff 配置
 *   - 失败可观测：failed_jobs 表 + queue:failed
 *   - 并发可控：多 worker 进程 + queue 优先级
 */
return new class extends Migration {

    public function up(): void
    {
        if (!Schema::hasTable('jobs')) {
            Schema::create('jobs', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->string('queue')->index();
                $table->longText('payload');
                $table->unsignedTinyInteger('attempts');
                $table->unsignedInteger('reserved_at')->nullable();
                $table->unsignedInteger('available_at');
                $table->unsignedInteger('created_at');
            });
        }

        if (!Schema::hasTable('failed_jobs')) {
            Schema::create('failed_jobs', function (Blueprint $table) {
                $table->id();
                $table->string('uuid')->unique();
                $table->text('connection');
                $table->text('queue');
                $table->longText('payload');
                $table->longText('exception');
                $table->timestamp('failed_at')->useCurrent();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('failed_jobs');
        Schema::dropIfExists('jobs');
    }
};
