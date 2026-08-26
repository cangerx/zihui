<?php

namespace App\Http\Controllers\App\V1;

use App\Http\Controllers\GatewayController;
use App\Models\ImageTask;
use App\Models\AppAsset;
use App\Models\CloudModel;
use App\Models\ModelAssignment;
use App\Support\AppV1Response;
use App\Support\AppV1TaskPresenter;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\DB;

class TaskController
{
    public function createImage(Request $request)
    {
        if (!$this->imageEnabled()) return $this->disabled();
        $validator = Validator::make($request->all(), [
            'model' => ['required', 'string', 'max:200'],
            'prompt' => ['required', 'string', 'max:20000'],
            'cloud_model_id' => ['nullable', 'integer'],
            'n' => ['nullable', 'integer', 'min:1', 'max:4'],
            'size' => ['nullable', 'string', 'max:30'],
            'quality' => ['nullable', 'string', 'max:30'],
            'ratio' => ['nullable', 'string', 'max:20'],
            'asset_ids' => ['nullable', 'array', 'max:4'],
        ]);
        if ($validator->fails()) return AppV1Response::error('validation_error', $validator->errors()->first(), 422);
        $prohibited = ['image_urls', 'images', 'image', 'mask', 'mask_url', 'object_key', 'storage_key', 'base64', 'app_asset_ids'];
        foreach ($prohibited as $field) {
            if ($request->exists($field)) return AppV1Response::error('invalid_asset_ids', "字段 {$field} 不允许使用", 422);
        }

        $assetIds = array_values((array) $request->input('asset_ids', []));
        if (count($assetIds) !== count(array_unique($assetIds)) || count($assetIds) > 4) {
            return AppV1Response::error('invalid_asset_ids', '参考图数量或 ID 无效', 422);
        }
        $assets = collect();
        if ($assetIds !== []) {
            if (!config('app_v1.features.assets', false)) return AppV1Response::error('feature_disabled', '素材功能暂未开放', 503);
            if (count(array_filter($assetIds, fn ($id) => is_string($id) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $id) === 1)) !== count($assetIds)) {
                return AppV1Response::error('invalid_asset_ids', '参考图 ID 无效', 422);
            }
            $assets = DB::transaction(function () use ($request, $assetIds) {
                return AppAsset::query()->where('user_id', $request->user()->id)->where('kind', 'image')
                    ->where('status', 'ready')->where('expires_at', '>', now())->whereIn('id', $assetIds)
                    ->lockForUpdate()->get();
            });
            if ($assets->count() !== count($assetIds)) return AppV1Response::error('invalid_asset_ids', '参考图不可用', 422);
            $assets = $assets->keyBy('id');
        }

        $model = $this->resolveImageModel($request->user(), $request->input('model'), $request->input('cloud_model_id'));
        if ($model instanceof \Illuminate\Http\JsonResponse) return $model;

        $payload = $request->only(['model', 'prompt', 'cloud_model_id', 'n', 'size', 'quality', 'ratio']);
        if ($assetIds !== []) {
            $payload['image_urls'] = collect($assetIds)->map(fn ($id) => $assets[(string) $id]->storage_url)->values()->all();
            $payload['app_asset_ids'] = $assetIds;
        }
        $payload['model'] = $model->model_id;
        $payload['cloud_model_id'] = $model->id;
        $gatewayRequest = Request::create('/api/gateway/images/generations', 'POST', $payload);
        $response = app(GatewayController::class)->imageGenerations($gatewayRequest);
        if ($response->getStatusCode() >= 400) {
            return AppV1Response::error('gateway_error', $this->gatewayError($response->getData(true)), $response->getStatusCode());
        }
        $data = $response->getData(true);
        $id = (string) ($data['task_id'] ?? '');
        $task = $id !== '' ? ImageTask::where('id', $id)->where('user_id', $request->user()->id)->first() : null;
        if (!$task) return AppV1Response::error('task_create_failed', '任务创建失败', 502);

        return AppV1Response::ok(AppV1TaskPresenter::image($task), 202);
    }

    public function index(Request $request)
    {
        if (!$this->imageEnabled()) return $this->disabled();
        $query = ImageTask::query()->where('user_id', $request->user()->id)->orderByDesc('created_at');
        if ($request->filled('status')) {
            $status = match ($request->string('status')->toString()) {
                'queued' => 'pending',
                'processing' => 'processing',
                'succeeded' => 'completed',
                'failed' => 'failed',
                'cancelled' => 'cancelled',
                default => null,
            };
            if ($status) $query->where('status', $status);
        }
        $tasks = $query->limit(min(100, max(1, (int) $request->input('limit', 30))))->get();
        return AppV1Response::ok($tasks->map(fn (ImageTask $task) => AppV1TaskPresenter::image($task))->values()->all());
    }

    public function show(Request $request, string $id)
    {
        if (!$this->imageEnabled()) return $this->disabled();
        $task = ImageTask::where('id', $id)->where('user_id', $request->user()->id)->first();
        if (!$task) return AppV1Response::error('not_found', 'Task not found', 404);
        return AppV1Response::ok(AppV1TaskPresenter::image($task));
    }

    public function cancel(Request $request, string $id)
    {
        if (!$this->imageEnabled()) return $this->disabled();
        $task = ImageTask::where('id', $id)->where('user_id', $request->user()->id)->first();
        if (!$task) return AppV1Response::error('not_found', 'Task not found', 404);
        if ($task->status === 'pending') {
            $task->update(['status' => 'cancelled', 'error' => 'Cancelled by user']);
            return AppV1Response::ok(AppV1TaskPresenter::image($task->fresh()));
        }
        if ($task->status === 'processing') return AppV1Response::error('task_not_cancellable', '任务已开始处理，无法取消', 409);
        return AppV1Response::ok(AppV1TaskPresenter::image($task));
    }

    public function destroy(Request $request, string $id)
    {
        if (!$this->imageEnabled()) return $this->disabled();
        $task = ImageTask::where('id', $id)->where('user_id', $request->user()->id)->first();
        if (!$task) return AppV1Response::error('not_found', 'Task not found', 404);
        if (in_array($task->status, ['pending', 'processing'], true)) {
            return AppV1Response::error('task_not_deletable', '任务处理完成前不能删除', 409);
        }
        $task->delete();
        return AppV1Response::ok(null);
    }

    private function imageEnabled(): bool
    {
        return (bool) config('app_v1.features.image', false);
    }

    private function resolveImageModel($user, ?string $modelId, $cloudModelId)
    {
        $query = CloudModel::query()->where('type', 'image')->where('status', 'active')
            ->whereHas('provider', fn ($q) => $q->where('status', 'active'))->with('provider');
        if ($cloudModelId !== null && $cloudModelId !== '') {
            $query->where('id', (int) $cloudModelId);
        } elseif ($modelId) {
            $query->where(fn ($q) => $q->where('model_id', $modelId)->orWhere('name', $modelId));
        }
        $models = $query->orderBy('id')->get()->filter(fn (CloudModel $model) => $this->authorized($user, $model));
        if ($models->count() > 1 && $cloudModelId === null) {
            return AppV1Response::error('ambiguous_model', '模型路由不唯一，请重新选择模型', 409);
        }
        $model = $models->first();
        if (!$model) return AppV1Response::error('model_unavailable', '当前没有可用的图片模型', 503);
        return $model;
    }

    private function authorized($user, CloudModel $model): bool
    {
        if (ModelAssignment::where('cloud_model_id', $model->id)->where('assignee_type', 'user')->where('assignee_id', $user->id)->exists()) return true;
        $groupIds = $user->groups()->pluck('user_groups.id')->all();
        return $groupIds !== [] && ModelAssignment::where('cloud_model_id', $model->id)->where('assignee_type', 'group')->whereIn('assignee_id', $groupIds)->exists();
    }

    private function disabled()
    {
        return AppV1Response::error('feature_disabled', '图片功能暂未开放', 503);
    }

    private function gatewayError(array $payload): string
    {
        $error = $payload['error'] ?? null;
        if (is_array($error)) {
            return (string) ($error['message'] ?? $error['error'] ?? '图片任务提交失败');
        }
        return (string) ($payload['message'] ?? $error ?? '图片任务提交失败');
    }
}
