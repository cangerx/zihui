<?php

namespace App\Jobs;

use App\Models\SystemSetting;
use App\Models\VideoTask;
use App\Services\Video\VideoTaskService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Throwable;

class PollVideoTaskJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;
    public int $timeout = 120;

    public function __construct(public string $taskId)
    {
        $this->onQueue('video');
    }

    public function handle(VideoTaskService $service): void
    {
        @set_time_limit(0);

        if (config('queue.default', 'sync') === 'sync') {
            $this->handleSyncLoop($service);
            return;
        }

        $task = VideoTask::find($this->taskId);
        if (!$task || in_array($task->status, ['completed', 'failed', 'canceled'], true)) return;
        if ($this->isExpired($task)) {
            $this->markTimeout($task, $service);
            return;
        }

        $refreshed = $service->refresh($task);
        if ($refreshed && !in_array($refreshed->status, ['completed', 'failed', 'canceled'], true)) {
            self::dispatch($this->taskId)->delay(now()->addSeconds($this->intervalSeconds()));
        }
    }

    public function failed(Throwable $e): void
    {
        Log::error('[PollVideoTaskJob] failed: ' . $this->taskId . ' ' . $e->getMessage());
    }

    private function handleSyncLoop(VideoTaskService $service): void
    {
        $deadline = time() + $this->timeoutSeconds();
        while (time() < $deadline) {
            $task = VideoTask::find($this->taskId);
            if (!$task || in_array($task->status, ['completed', 'failed', 'canceled'], true)) return;
            if ($this->isExpired($task)) {
                $this->markTimeout($task, $service);
                return;
            }
            $refreshed = $service->refresh($task);
            if ($refreshed && in_array($refreshed->status, ['completed', 'failed', 'canceled'], true)) return;
            sleep($this->intervalSeconds());
        }

        $task = VideoTask::find($this->taskId);
        if ($task && !in_array($task->status, ['completed', 'failed', 'canceled'], true)) {
            $this->markTimeout($task, $service);
        }
    }

    private function isExpired(VideoTask $task): bool
    {
        $createdAt = $task->submitted_at ?: $task->created_at;
        return $createdAt && $createdAt->copy()->addSeconds($this->timeoutSeconds())->isPast();
    }

    private function markTimeout(VideoTask $task, VideoTaskService $service): void
    {
        $task->update([
            'status' => 'failed',
            'error_code' => 'poll_timeout',
            'error_message' => '视频任务轮询超时',
            'failed_at' => now(),
        ]);
        $service->recordUsage($task->fresh(), 'failed', 0, 'poll timeout');
    }

    private function intervalSeconds(): int
    {
        return max(5, min(60, (int)SystemSetting::getValue('video_poll_interval_seconds', 10)));
    }

    private function timeoutSeconds(): int
    {
        return max(300, min(14400, (int)SystemSetting::getValue('video_poll_timeout_seconds', 3600)));
    }
}
