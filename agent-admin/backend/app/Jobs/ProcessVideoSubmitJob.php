<?php

namespace App\Jobs;

use App\Models\VideoTask;
use App\Services\Video\VideoProviderManager;
use App\Services\Video\VideoTaskService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Throwable;

class ProcessVideoSubmitJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 2;
    public int $timeout = 180;

    public function __construct(public string $taskId)
    {
        $this->onQueue('video');
    }

    public function backoff(): int
    {
        return 30;
    }

    public function handle(VideoProviderManager $manager, VideoTaskService $service): void
    {
        @set_time_limit(0);

        $task = VideoTask::with(['account', 'modelSpec', 'sku', 'user'])->find($this->taskId);
        if (!$task) {
            Log::warning('[ProcessVideoSubmitJob] task not found: ' . $this->taskId);
            return;
        }
        if (in_array($task->status, ['completed', 'failed', 'canceled'], true)) {
            return;
        }
        // 已拿到上游任务 ID（重试 / 重复派发场景）：不再重复提交，直接进入轮询，避免向上游重复下单。
        if ($task->provider_task_id) {
            $this->dispatchPoll();
            return;
        }
        if (!$task->account) {
            $task->update(['status' => 'failed', 'error_message' => '视频服务商账号不存在', 'failed_at' => now()]);
            $service->recordUsage($task->fresh(), 'failed', 0, 'provider account missing');
            return;
        }

        $task->update(['status' => 'submitting', 'progress' => max(1, (int)$task->progress)]);

        try {
            $submit = $manager->driver($task->account)->submit($task->fresh(['account', 'modelSpec', 'sku']), $task->account);
        } catch (Throwable $e) {
            $task->update([
                'status' => 'failed',
                'error_code' => 'submit_exception',
                'error_message' => $e->getMessage(),
                'failed_at' => now(),
            ]);
            $service->recordUsage($task->fresh(), 'failed', 0, $e->getMessage());
            throw $e;
        }

        if (!$submit->ok) {
            $task->update([
                'status' => 'failed',
                'provider_status' => $submit->providerStatus,
                'provider_response' => $submit->response,
                'submit_payload' => $submit->submitPayload,
                'error_code' => $submit->errorCode,
                'error_message' => $submit->errorMessage,
                'failed_at' => now(),
            ]);
            $service->recordUsage($task->fresh(), 'failed', 0, $submit->errorMessage);
            return;
        }

        // 条件更新：提交期间任务若已被取消 / 终结，则不覆盖终态（whereNotIn 兜住竞态）。
        $updated = VideoTask::where('id', $this->taskId)
            ->whereNotIn('status', ['completed', 'failed', 'canceled'])
            ->update([
                'status' => 'submitted',
                'provider_task_id' => $submit->providerTaskId,
                'provider_status' => $submit->providerStatus ?: 'submitted',
                'provider_response' => $submit->response,
                'submit_payload' => $submit->submitPayload,
                'submitted_at' => now(),
                'progress' => max(5, (int)$task->progress),
            ]);

        if ($updated === 0) {
            Log::warning('[ProcessVideoSubmitJob] task reached terminal state during submit, skip overwrite', [
                'task' => $this->taskId,
                'provider_task_id' => $submit->providerTaskId,
            ]);
            return;
        }

        $this->dispatchPoll();
    }

    private function dispatchPoll(): void
    {
        if (config('queue.default', 'sync') === 'sync') {
            app()->call([new PollVideoTaskJob($this->taskId), 'handle']);
        } else {
            PollVideoTaskJob::dispatch($this->taskId)->delay(now()->addSeconds(10));
        }
    }

    public function failed(Throwable $e): void
    {
        $task = VideoTask::find($this->taskId);
        if ($task && !in_array($task->status, ['completed', 'failed', 'canceled'], true)) {
            $task->update([
                'status' => 'failed',
                'error_code' => 'submit_job_failed',
                'error_message' => 'Job failed: ' . $e->getMessage(),
                'failed_at' => now(),
            ]);
            app(VideoTaskService::class)->recordUsage($task->fresh(), 'failed', 0, $e->getMessage());
        }
        Log::error('[ProcessVideoSubmitJob] permanently failed: ' . $this->taskId . ' ' . $e->getMessage());
    }
}
