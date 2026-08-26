<?php

namespace App\Jobs;

use App\Http\Controllers\FineMattingController;
use App\Models\FineMattingTask;
use App\Services\BalanceService;
use App\Services\FineMatting\FineMattingConcurrencyLimiter;
use App\Services\Koukoutu\KoukoutuMattingService;
use App\Services\QuotaService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * 精细抠图任务异步处理（抠抠图 koukoutu create → poll）。
 *
 * 执行模式与 ProcessMattingTaskJob 一致：
 *   - QUEUE_CONNECTION=sync（默认）→ Controller 用 terminating callback 包 handle()
 *   - QUEUE_CONNECTION=database → ::dispatch() 入队，worker 拉取
 *
 * 不同点：
 *   - 上游是抠抠图异步 API（KoukoutuMattingService）。
 *   - 计费已在提交时按尺寸三档算好写入 task.cost，这里直接扣。
 *   - 并发槽（FineMattingConcurrencyLimiter）在 handle() 末尾 release。
 *
 * 配套 worker 启动：
 *   php artisan queue:work database --queue=fine-matting,matting,image,default --tries=2 --timeout=200 --sleep=2
 */
class ProcessFineMattingTaskJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 2;
    public int $timeout = 200; // 抠抠图轮询最长 120s + buffer

    public function backoff(): int
    {
        return 15;
    }

    /**
     * @param string $taskId          fine_matting_tasks.id (UUID)
     * @param string $rateLimitToken  来自 FineMattingConcurrencyLimiter::tryAcquire，末尾必须 release
     * @param string $tempFilePath    Controller 落盘的上传文件绝对路径
     */
    public function __construct(
        public string $taskId,
        public string $rateLimitToken = '',
        public string $tempFilePath = ''
    ) {
        $this->onQueue('fine-matting');
    }

    public function handle(KoukoutuMattingService $svc, FineMattingConcurrencyLimiter $rl): void
    {
        @set_time_limit(0);

        $task = FineMattingTask::find($this->taskId);
        if (!$task) {
            Log::warning("[ProcessFineMattingTaskJob] task {$this->taskId} not found");
            $this->cleanup($rl);
            return;
        }

        if (in_array($task->status, ['completed', 'failed'], true)) {
            Log::info("[ProcessFineMattingTaskJob] task {$this->taskId} already {$task->status}, skip");
            $this->cleanup($rl);
            return;
        }

        $task->update(['status' => 'processing']);

        // 凭证从 SystemSetting (fine_matting_api_key) 读
        try {
            $svc->configure(FineMattingController::resolveCreds());
        } catch (Throwable $e) {
            $task->update(['status' => 'failed', 'error' => $e->getMessage()]);
            $this->cleanup($rl);
            throw $e;
        }

        try {
            if (empty($this->tempFilePath) || !is_file($this->tempFilePath)) {
                throw new \RuntimeException('临时文件已被清理或不存在');
            }
            $result = $svc->segmentLocalFile($this->tempFilePath);
        } catch (Throwable $e) {
            Log::warning("[ProcessFineMattingTaskJob] task {$this->taskId} failed: {$e->getMessage()}");
            $task->update(['status' => 'failed', 'error' => $e->getMessage()]);
            $this->cleanup($rl);
            throw $e;
        }

        // 计费：cost 在提交时已按尺寸三档算好
        // 上游已成功产图：扣费 / 配额 / 落库。
        // 若扣费失败（如并发提交导致余额被占用），标 failed 并 cleanup —— 重试时因 status=failed 直接 skip，
        // 避免 $tries 重试重复调用抠抠图（重复成本）。
        $user = $task->user;
        $credits = (float) $task->cost;

        try {
            if ($credits > 0 && $user) {
                app(BalanceService::class)->deduct(
                    $user,
                    'credit',
                    $credits,
                    'usage',
                    "fine_matting {$task->request_id}",
                    (string) $task->request_id
                );
            }
            if ($user) {
                app(QuotaService::class)->consumeForType($user, 'fine_matting', 1);
            }

            $task->update([
                'status'           => 'completed',
                'result'           => $result,
                'cost'             => $credits,
                'provider_task_id' => $result['provider_task_id'] ?? null,
            ]);
        } catch (Throwable $e) {
            Log::warning("[ProcessFineMattingTaskJob] task {$this->taskId} 计费失败: {$e->getMessage()}");
            $task->update(['status' => 'failed', 'error' => '计费失败：' . $e->getMessage()]);
            $this->cleanup($rl);
            throw $e;
        }

        $this->cleanup($rl);
    }

    public function failed(Throwable $e): void
    {
        $task = FineMattingTask::find($this->taskId);
        if ($task && !in_array($task->status, ['completed', 'failed'], true)) {
            $task->update(['status' => 'failed', 'error' => 'Job failed: ' . $e->getMessage()]);
        }
        // failed callback 里没法注入 rl，直接 forget token（列表惰性清理 + TTL 兜底）
        if (!empty($this->rateLimitToken)) {
            Cache::forget($this->rateLimitToken);
        }
        Log::error("[ProcessFineMattingTaskJob] {$this->taskId} permanently failed: {$e->getMessage()}");
    }

    private function cleanup(FineMattingConcurrencyLimiter $rl): void
    {
        if (!empty($this->rateLimitToken)) {
            $rl->release($this->rateLimitToken);
        }
        if (!empty($this->tempFilePath) && is_file($this->tempFilePath)) {
            @unlink($this->tempFilePath);
        }
    }
}
