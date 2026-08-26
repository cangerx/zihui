<?php

namespace App\Console\Commands;

use App\Jobs\ProcessImageTaskJob;
use App\Models\ImageTask;
use Illuminate\Console\Command;

/**
 * 调试 / 重跑入口：把任务重新投递到 Queue，由 worker 真正执行。
 *
 * 业务逻辑已全部迁移到 `App\Jobs\ProcessImageTaskJob`。本命令只剩两个用途：
 *   1. 手动重跑某个 pending/failed 任务：`php artisan image:process {taskId}`
 *   2. 加 `--sync` 同步执行（不入队、立刻在当前进程跑完）—— 排查问题时用
 *
 * 注意：仅当 QUEUE_CONNECTION=database 时需启动 worker 进程：
 *   `php artisan queue:work database --queue=image,default --tries=2 --timeout=960 --sleep=2`
 * sync driver（默认）下 dispatch 等同于在当前 artisan 进程同步跑，无需 worker。
 */
class ProcessImageTask extends Command
{
    protected $signature = 'image:process {taskId} {--sync : 同步执行（不入队），用于排查问题}';
    protected $description = 'Re-dispatch (or sync-run) an image generation task to the queue';

    public function handle(): int
    {
        $taskId = (string) $this->argument('taskId');
        $task = ImageTask::find($taskId);

        if (!$task) {
            $this->error("Task {$taskId} not found");
            return 1;
        }

        if ($this->option('sync')) {
            // 当前进程同步执行：方便看完整堆栈
            $this->info("[sync] running ProcessImageTaskJob for {$taskId} ...");
            app()->call([new ProcessImageTaskJob($taskId), 'handle']);
            $task->refresh();
            $this->info("status = {$task->status}");
            return $task->status === 'failed' ? 1 : 0;
        }

        ProcessImageTaskJob::dispatch($taskId);
        $this->info("Task {$taskId} dispatched to queue 'image'. Make sure `queue:work` worker is running.");
        return 0;
    }
}
