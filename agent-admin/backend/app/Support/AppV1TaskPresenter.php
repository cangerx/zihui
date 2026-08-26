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

        $request = self::publicRequest((array) $task->request_body);

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
            'request' => $request,
            'result' => $result,
            'error' => $status === 'failed' ? [
                'code' => 'task_failed',
                'message' => (string) ($task->error ?: '任务失败'),
            ] : null,
            'created_at' => optional($task->created_at)->toISOString(),
            'updated_at' => optional($task->updated_at)->toISOString(),
        ];
    }

    /** Remove internal routing/storage fields defensively before serializing App v1 tasks. */
    private static function publicRequest(array $request): array
    {
        foreach (array_keys($request) as $key) {
            $normalized = strtolower((string) $key);
            if ($normalized === '_app_asset_ids' || $normalized === 'app_asset_ids'
                || str_contains($normalized, 'storage_url') || str_contains($normalized, 'object_key')
                || str_contains($normalized, 'storage_key')) {
                unset($request[$key]);
                continue;
            }
            if (is_array($request[$key])) $request[$key] = self::publicRequest($request[$key]);
        }
        return $request;
    }
}
