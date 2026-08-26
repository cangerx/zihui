<?php

namespace App\Jobs;

use App\Http\Controllers\MattingController;
use App\Models\MattingTask;
use App\Services\Aliyun\AliyunMattingService;
use App\Services\BalanceService;
use App\Services\Matting\MattingRateLimiter;
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
 * 抠图任务异步处理。
 *
 * 跟 ProcessImageTaskJob 几乎一模一样的执行模式：
 *   - QUEUE_CONNECTION=sync（默认）→ Controller 用 terminating callback 包 handle()
 *   - QUEUE_CONNECTION=database → ::dispatch() 入队，worker 拉取
 *
 * 不同点：
 *   - 上游不是 OpenAI 协议，是阿里 viapi（用 AliyunMattingService 封装）
 *   - 输入文件通过 Cache 临时传递（base64 / 临时本地路径），TTL 30 min
 *   - 限流 token 在 handle() 末尾 release（rate limiter）
 *
 * 配套 worker 启动：
 *   php artisan queue:work database --queue=matting,image,default --tries=2 --timeout=120 --sleep=2
 */
class ProcessMattingTaskJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 2;
    public int $timeout = 120; // 阿里 60s + 60s buffer

    public function backoff(): int
    {
        return 15;
    }

    /**
     * @param string $taskId          matting_tasks.id (UUID)
     * @param string $rateLimitToken  来自 MattingRateLimiter::tryAcquire，handle() 末尾必须 release
     * @param string $tempFilePath    Controller 收到 upload 后落到 storage/app/tmp 的绝对路径；URL 模式留空
     */
    public function __construct(
        public string $taskId,
        public string $rateLimitToken = '',
        public string $tempFilePath = ''
    ) {
        $this->onQueue('matting');
    }

    public function handle(AliyunMattingService $svc, MattingRateLimiter $rl): void
    {
        @set_time_limit(0);

        $task = MattingTask::find($this->taskId);
        if (!$task) {
            Log::warning("[ProcessMattingTaskJob] task {$this->taskId} not found");
            $this->cleanup($rl);
            return;
        }

        if (in_array($task->status, ['completed', 'failed'], true)) {
            Log::info("[ProcessMattingTaskJob] task {$this->taskId} already {$task->status}, skip");
            $this->cleanup($rl);
            return;
        }

        $task->update(['status' => 'processing']);

        // v1.5.0+ 凭证 / 计费从 SystemSetting 读，不再依赖 cloud_model_id / billing_rules
        try {
            $svc->configure(MattingController::resolveCreds());
        } catch (Throwable $e) {
            $task->update(['status' => 'failed', 'error' => $e->getMessage()]);
            $this->cleanup($rl);
            throw $e;
        }

        try {
            if ($task->source === 'url') {
                // URL 模式：从 Cache 拉公网 URL
                $url = (string) Cache::pull("matting:task:{$task->id}:url");
                if (empty($url)) {
                    throw new \RuntimeException('URL 已过期或缺失（task body 仅 30 分钟 TTL）');
                }
                $result = $svc->segmentImageUrl($url);
            } else {
                // upload 模式：tempFilePath 由 Controller 写盘传入
                if (empty($this->tempFilePath) || !is_file($this->tempFilePath)) {
                    throw new \RuntimeException('临时文件已被清理或不存在');
                }
                $result = $svc->segmentLocalFile($this->tempFilePath);
            }
        } catch (Throwable $e) {
            Log::warning("[ProcessMattingTaskJob] task {$this->taskId} failed: {$e->getMessage()}");
            $task->update(['status' => 'failed', 'error' => $e->getMessage()]);
            $this->cleanup($rl);
            throw $e;
        }

        $user = $task->user;
        $credits = (float)$task->cost;
        $deduction = ['source_plan_id' => null];

        if ($credits > 0) {
            $deduction = app(BalanceService::class)->deduct($user, 'credit', $credits, 'usage', "matting {$task->request_id}", (string)$task->request_id);
        }
        app(QuotaService::class)->consumeForType($user, 'matting', 1);

        $task->update([
            'status' => 'completed',
            'result' => $result,
            'cost'   => $credits,
        ]);

        $this->cleanup($rl);
    }

    public function failed(Throwable $e): void
    {
        $task = MattingTask::find($this->taskId);
        if ($task && !in_array($task->status, ['completed', 'failed'], true)) {
            $task->update(['status' => 'failed', 'error' => 'Job failed: ' . $e->getMessage()]);
        }
        // failed callback 里没法注入 rl，简单 Cache::forget
        if (!empty($this->rateLimitToken)) {
            Cache::forget($this->rateLimitToken);
        }
        Log::error("[ProcessMattingTaskJob] {$this->taskId} permanently failed: {$e->getMessage()}");
    }

    private function cleanup(MattingRateLimiter $rl): void
    {
        if (!empty($this->rateLimitToken)) {
            $rl->release($this->rateLimitToken);
        }
        if (!empty($this->tempFilePath) && is_file($this->tempFilePath)) {
            @unlink($this->tempFilePath);
        }
    }

}
