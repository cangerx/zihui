<?php

namespace App\Support;

use App\Models\ImageTask;
use Illuminate\Support\Facades\Cache;

class AppV1TaskPresenter
{
    public static function image(ImageTask $task): array
    {
        $status = match ((string) $task->status) {
            'pending' => 'queued',
            'processing' => 'processing',
            'completed' => 'succeeded',
            'cancelled', 'canceled' => 'cancelled',
            default => 'failed',
        };

        $result = null;
        if ($status === 'succeeded') {
            $result = Cache::get("itask:result:{$task->id}") ?? $task->result;
        } elseif ($status === 'failed') {
            $result = null;
        }

        return [
            'id' => (string) $task->id,
            'type' => 'image',
            'status' => $status,
            'progress' => match ($status) {
                'queued' => 0,
                'processing' => 50,
                'succeeded' => 100,
                'failed', 'cancelled' => 0,
                default => 0,
            },
            'request' => (array) $task->request_body,
            'result' => $result,
            'error' => $status === 'failed' ? [
                'code' => 'task_failed',
                'message' => (string) ($task->error ?: '任务失败'),
            ] : null,
            'created_at' => optional($task->created_at)->toISOString(),
            'updated_at' => optional($task->updated_at)->toISOString(),
        ];
    }
}
