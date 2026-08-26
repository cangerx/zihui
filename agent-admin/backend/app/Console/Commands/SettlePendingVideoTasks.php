<?php

namespace App\Console\Commands;

use App\Models\SystemSetting;
use App\Models\VideoTask;
use App\Services\Video\VideoTaskService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * 视频任务兜底结算：保证「完成必扣」。
 *
 * 正常链路 ProcessVideoSubmitJob → PollVideoTaskJob 会在任务完成时 chargeAndRecord 扣费；
 * 但 PollVideoTaskJob 是 tries=1，单次轮询异常（网络抖动 / worker 重启 / sync 模式 PHP 超时）
 * 即断链，任务会永久卡在非终态、漏扣。
 *
 * 本命令由 Kernel 每分钟调度（cron 驱动 schedule:run，不依赖 queue worker），扫描「停滞」
 * （updated_at 长时间未变动）的非终态任务，主动 refresh：
 *   - 上游已完成 → applyQueryResult 内 chargeAndRecord 扣费（billing_status 幂等，重复安全）
 *   - 已超时 → 标记 failed（不扣费）
 * 从而即使链式轮询中断，也能兜底完成扣费，做到「完成必扣」。
 */
class SettlePendingVideoTasks extends Command
{
    protected $signature = 'video:settle-pending
        {--limit=30 : 单次最多处理的任务数}
        {--stalled=90 : 视为「停滞」的最小静默秒数（updated_at 距今）}';

    protected $description = '兜底结算停滞的视频任务，保证完成必扣';

    public function handle(VideoTaskService $service): int
    {
        $limit = max(1, min(200, (int) $this->option('limit')));
        $stalled = max(30, min(3600, (int) $this->option('stalled')));
        // 与 PollVideoTaskJob 共用同一超时口径（默认 1 小时）
        $timeoutSeconds = max(300, min(14400, (int) SystemSetting::getValue('video_poll_timeout_seconds', 3600)));
        $cutoff = now()->subSeconds($stalled);

        $tasks = VideoTask::whereIn('status', ['pending', 'submitting', 'submitted', 'running'])
            ->where('updated_at', '<=', $cutoff)
            ->orderBy('updated_at')
            ->limit($limit)
            ->get();

        if ($tasks->isEmpty()) {
            return self::SUCCESS;
        }

        $completed = 0;
        $failed = 0;
        $skipped = 0;
        foreach ($tasks as $task) {
            try {
                $startedAt = $task->submitted_at ?: $task->created_at;
                $timedOut = $startedAt && $startedAt->copy()->addSeconds($timeoutSeconds)->isPast();

                // 尚未拿到上游任务 ID：仍在提交阶段，无法 query。超时则判失败，否则交回提交链路。
                if (!$task->provider_task_id) {
                    if ($timedOut) {
                        $this->failTask($service, $task, 'settle_timeout', '视频任务提交后超时未就绪', 'settle timeout (no provider task id)');
                        $failed++;
                    } else {
                        $skipped++;
                    }
                    continue;
                }

                if ($timedOut) {
                    $this->failTask($service, $task, 'settle_timeout', '视频任务轮询超时', 'settle timeout');
                    $failed++;
                    continue;
                }

                $refreshed = $service->refresh($task);
                if ($refreshed && $refreshed->status === 'completed') {
                    $completed++;
                } elseif ($refreshed && $refreshed->status === 'failed') {
                    $failed++;
                }
            } catch (\Throwable $e) {
                Log::warning('[video:settle-pending] task ' . $task->id . ' error: ' . $e->getMessage());
            }
        }

        $this->info("video settle: scanned={$tasks->count()} completed={$completed} failed={$failed} skipped={$skipped}");
        return self::SUCCESS;
    }

    private function failTask(VideoTaskService $service, VideoTask $task, string $code, string $message, string $usageNote): void
    {
        $task->update([
            'status' => 'failed',
            'error_code' => $code,
            'error_message' => $message,
            'failed_at' => now(),
        ]);
        $service->recordUsage($task->fresh(), 'failed', 0, $usageNote);
    }
}
