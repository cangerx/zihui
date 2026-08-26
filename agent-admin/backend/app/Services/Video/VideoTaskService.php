<?php

namespace App\Services\Video;

use App\Jobs\PollVideoTaskJob;
use App\Jobs\ProcessVideoSubmitJob;
use App\Models\SystemSetting;
use App\Models\User;
use App\Models\VideoProviderAccount;
use App\Models\VideoResult;
use App\Models\VideoSkuPrice;
use App\Models\VideoTask;
use App\Models\VideoUsageRecord;
use App\Services\BalanceService;
use App\Services\QuotaService;
use App\Services\RateLimitService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class VideoTaskService
{
    public function catalog(User $user): array
    {
        $activeAccounts = VideoProviderAccount::where('status', 'active')
            ->whereNotNull('api_key')->where('api_key', '<>', '')->get(['provider_key', 'name']);
        if ($activeAccounts->isEmpty()) {
            return ['enabled' => false, 'models' => []];
        }

        // provider_key → 服务商展示名（同标识多账号取首个），用于同名模型追加服务商后缀
        $providerNames = [];
        foreach ($activeAccounts as $acc) {
            if (!isset($providerNames[$acc->provider_key])) {
                $providerNames[$acc->provider_key] = (string) ($acc->name ?: $acc->provider_key);
            }
        }

        $skus = app(VideoCatalogDiagnosticsService::class)->visibleSkus();

        $models = [];
        foreach ($skus as $sku) {
            $spec = $sku->modelSpec;
            if (!$spec) continue;
            $key = $spec->model_id;
            if (!isset($models[$key])) {
                $models[$key] = [
                    'id' => (int)$spec->id,
                    'provider_key' => $spec->provider_key,
                    'provider_protocol' => $spec->provider_protocol,
                    'model_id' => $spec->model_id,
                    'display_name' => $spec->display_name,
                    'generation_type' => $spec->generation_type,
                    'supported_modes' => $spec->supported_modes ?: [],
                    'supported_durations' => $spec->supported_durations ?: [],
                    'supported_resolutions' => $spec->supported_resolutions ?: [],
                    'supported_aspect_ratios' => $spec->supported_aspect_ratios ?: [],
                    'max_reference_images' => (int)$spec->max_reference_images,
                    // 参考素材类型白名单：与后端 assertAssetsSupported 同源，桌面端据此精确渲染上传入口
                    'supported_ref_media' => app(VideoSkuSupportService::class)->allowedRefMedia($spec),
                    'description' => $spec->description,
                    'skus' => [],
                ];
            }
            $billing = app(VideoBillingContextService::class)->resolve($user, $sku);
            $models[$key]['skus'][] = [
                'id' => (int)$sku->id,
                'sku_key' => $sku->sku_key,
                'title' => $sku->title,
                'mode' => $sku->mode,
                'duration_seconds' => (int)$sku->duration_seconds,
                'resolution' => $sku->resolution,
                'aspect_ratio' => $sku->aspect_ratio,
                'quality' => $sku->quality,
                'credit_cost' => $billing['credit_cost'],
                'price_label' => $billing['price_label'],
            ];
        }

        // 不同服务商但 display_name 相同的模型，追加「· 服务商名」后缀，便于桌面端区分归属
        $nameCount = [];
        foreach ($models as $m) {
            $nameCount[$m['display_name']] = ($nameCount[$m['display_name']] ?? 0) + 1;
        }
        foreach ($models as &$model) {
            if (($nameCount[$model['display_name']] ?? 0) > 1) {
                $model['display_name'] .= ' · ' . ($providerNames[$model['provider_key']] ?? $model['provider_key']);
            }
        }
        unset($model);

        return ['enabled' => true, 'models' => array_values($models)];
    }

    public function create(User $user, array $payload): VideoTask
    {
        $policies = app(QuotaService::class)->policies($user);

        app(QuotaService::class)->assertAvailableForType($user, 'video', 1);
        app(RateLimitService::class)->assertAllowed($user, 'video', app(RateLimitService::class)->effectiveLimits($user, 'video', $policies));

        $sku = VideoSkuPrice::with('modelSpec')
            ->where('sku_key', (string)$payload['sku_key'])
            ->where('status', 'active')
            ->first();
        if (!$sku || !$sku->modelSpec || $sku->modelSpec->status !== 'active') {
            throw new \InvalidArgumentException('视频 SKU 不存在或未启用');
        }
        if ($sku->default_credit_cost === null) {
            throw new \InvalidArgumentException('视频 SKU 尚未配置扣费');
        }
        app(VideoSkuSupportService::class)->assertSkuSupported($sku);

        $spec = $sku->modelSpec;
        // 合并生成参数：SKU 锁定（非空）的计费维度优先，未锁定的用提交的自选值
        $requestParams = [
            'mode' => (string)$sku->mode !== '' ? (string)$sku->mode : (string)($payload['mode'] ?? ''),
            'duration' => (int)$sku->duration_seconds > 0 ? (int)$sku->duration_seconds : (int)($payload['duration_seconds'] ?? 0),
            'resolution' => (string)$sku->resolution !== '' ? (string)$sku->resolution : (string)($payload['resolution'] ?? ''),
            'aspect_ratio' => (string)$sku->aspect_ratio !== '' ? (string)$sku->aspect_ratio : (string)($payload['aspect_ratio'] ?? ''),
            'quality' => (string)$sku->quality,
        ];
        app(VideoSkuSupportService::class)->assertGenerationParams($spec, $requestParams);

        $account = $this->selectAccount($sku->provider_key);
        $billing = app(VideoBillingContextService::class)->resolve($user, $sku);
        $needed = (float)$billing['credit_cost'];
        $balance = app(BalanceService::class)->totalBalance($user->id, 'credit');
        if ($needed > 0 && $balance + 0.0000001 < $needed) {
            throw new \RuntimeException('Insufficient credit balance');
        }

        $referenceAssets = $this->normalizeReferenceAssets($payload);
        $referenceImages = array_values(array_map(fn($asset) => $asset['url'], array_filter($referenceAssets, fn($asset) => ($asset['asset_type'] ?? '') === 'image')));
        $referenceVideos = array_values(array_map(fn($asset) => $asset['url'], array_filter($referenceAssets, fn($asset) => ($asset['asset_type'] ?? '') === 'video')));
        $referenceAudios = array_values(array_map(fn($asset) => $asset['url'], array_filter($referenceAssets, fn($asset) => ($asset['asset_type'] ?? '') === 'audio')));
        app(VideoSkuSupportService::class)->assertAssetsSupported($spec, $referenceAssets);
        if ($requestParams['mode'] === 'first_last_frame' && (string)$sku->provider_protocol !== 'veo') {
            $firstFrame = $this->findReferenceAssetByRole($referenceAssets, 'first_frame');
            $lastFrame = $this->findReferenceAssetByRole($referenceAssets, 'last_frame');
            if (!$firstFrame || !$lastFrame) {
                throw new \InvalidArgumentException('首尾帧模式需要分别上传首帧图和尾帧图');
            }
            if (count($referenceImages) !== 2 || count($referenceVideos) > 0) {
                throw new \InvalidArgumentException('首尾帧模式只能包含首帧图和尾帧图');
            }
        }

        $inputAssets = [
            'assets' => $referenceAssets,
            'images' => $referenceImages,
            'videos' => $referenceVideos,
            'audios' => $referenceAudios,
            'notes' => (string)($payload['reference_asset_notes'] ?? ''),
        ];

        $task = DB::transaction(function () use ($user, $payload, $sku, $account, $billing, $requestParams, $inputAssets) {
            return VideoTask::create([
                'id' => Str::uuid()->toString(),
                'user_id' => $user->id,
                'video_provider_account_id' => $account->id,
                'video_model_spec_id' => $sku->video_model_spec_id,
                'video_sku_price_id' => $sku->id,
                'provider_key' => $sku->provider_key,
                'provider_protocol' => $sku->provider_protocol,
                'model_id' => $sku->model_id,
                'sku_key' => $sku->sku_key,
                'request_id' => Str::uuid()->toString(),
                'status' => 'pending',
                'provider_status' => '',
                'progress' => 0,
                'prompt' => (string)($payload['prompt'] ?? ''),
                'negative_prompt' => (string)($payload['negative_prompt'] ?? ''),
                'input_assets' => $inputAssets,
                'request_params' => $requestParams,
                'billing_snapshot' => $billing,
                'billing_status' => 'pending',
                'estimated_credits' => (float)$billing['credit_cost'],
            ]);
        });

        app(TemporaryReferenceAssetService::class)->bindToTask(array_merge($referenceImages, $referenceVideos, $referenceAudios), $task->id, (int)$user->id);
        $this->dispatchSubmit($task->id);

        return $task->fresh(['modelSpec', 'sku', 'result']);
    }

    public function refresh(VideoTask $task): VideoTask
    {
        $task = $task->fresh(['account', 'modelSpec', 'sku', 'result']);
        if (!$task || in_array($task->status, ['completed', 'failed', 'canceled'], true)) {
            return $task;
        }
        if (!$task->account) {
            $task->update(['status' => 'failed', 'error_message' => '视频服务商账号不存在', 'failed_at' => now()]);
            return $task->fresh(['result']);
        }

        // 尚未拿到上游任务 ID：仍在提交阶段，不能 query（否则必拿到 missing_provider_task_id）。
        // 超时则判失败，否则原样返回，交回提交链路 / 等待下一轮轮询。
        if (!$task->provider_task_id) {
            if ($this->isSubmitExpired($task)) {
                $task->update([
                    'status' => 'failed',
                    'error_code' => 'submit_timeout',
                    'error_message' => '视频任务提交后超时未就绪',
                    'failed_at' => now(),
                ]);
                $this->recordUsage($task->fresh(), 'failed', 0, 'submit timeout (no provider task id)');
                return $task->fresh(['result']);
            }
            return $task;
        }

        $query = app(VideoProviderManager::class)->driver($task->account)->query($task, $task->account);
        $this->applyQueryResult($task, $query);
        return $task->fresh(['result', 'sku', 'modelSpec']);
    }

    public function applyQueryResult(VideoTask $task, VideoQueryResult $query): void
    {
        if (!$query->ok) {
            // 仅当上游「明确判定任务失败」时才落 failed。
            // missing_provider_task_id（提交尚未完成）/ connection_error（网络抖动）/ http_xxx（上游查询接口临时异常）
            // 都属于「暂不可结论」：保留原状态，交给下一轮轮询与 video:settle-pending 超时兜底，避免把正常任务误杀。
            // 终态失败判定：上游「查询成功但任务失败」的错误码（兜底 provider_failed，或新契约透传的
            // content_policy_violation / material_limit_exceeded 等 error.code 语义码）一律落 failed；
            // 仅 missing_provider_task_id / connection_error / http_* 属「暂不可结论」的瞬时问题，保留原状态。
            $transient = $query->errorCode === 'missing_provider_task_id'
                || $query->errorCode === 'connection_error'
                || str_starts_with($query->errorCode, 'http_');
            if (!$transient) {
                $task->update([
                    'status' => 'failed',
                    'provider_status' => $query->providerStatus,
                    'provider_response' => $query->response,
                    'error_code' => $query->errorCode ?: 'provider_failed',
                    'error_message' => $query->errorMessage,
                    'failed_at' => now(),
                ]);
                $this->recordUsage($task->fresh(), 'failed', 0, $query->errorMessage);
                return;
            }

            Log::info('[VideoTaskService] transient query issue, keep current status', [
                'task' => $task->id,
                'status' => $task->status,
                'error_code' => $query->errorCode,
                'error_message' => $query->errorMessage,
            ]);
            return;
        }

        $updates = [
            'status' => $query->status,
            'provider_status' => $query->providerStatus,
            'progress' => $query->progress,
            'provider_response' => $query->response,
        ];

        if ($query->status === 'completed') {
            if ($query->videoUrl === '') {
                $updates['status'] = 'failed';
                $updates['error_code'] = 'missing_video_url';
                $updates['error_message'] = '上游任务完成但未返回视频 URL';
                $updates['failed_at'] = now();
                $task->update($updates);
                $this->recordUsage($task->fresh(), 'failed', 0, 'missing video url');
                return;
            }
            $updates['completed_at'] = now();
            $task->update($updates);
            app(VideoAssetService::class)->storeRemoteResult($task->fresh(), $query->videoUrl, $query->coverUrl, $query->metadata);
            $this->chargeAndRecord($task->fresh(['user']));
            return;
        }

        if ($query->status === 'canceled') {
            $updates['completed_at'] = now();
        }
        $task->update($updates);
    }

    public function cancel(VideoTask $task): VideoTask
    {
        if (in_array($task->status, ['completed', 'failed', 'canceled'], true)) return $task;
        $account = $task->account;
        if ($account) {
            app(VideoProviderManager::class)->driver($account)->cancel($task, $account);
        }
        $task->update(['status' => 'canceled', 'provider_status' => 'canceled', 'completed_at' => now()]);
        return $task->fresh(['result']);
    }

    public function chargeAndRecord(VideoTask $task): void
    {
        DB::transaction(function () use ($task) {
            $locked = VideoTask::lockForUpdate()->with('user')->find($task->id);
            if (!$locked || $locked->billing_status === 'charged') return;

            $credits = (float)($locked->billing_snapshot['credit_cost'] ?? $locked->estimated_credits ?? 0);
            $sourcePlanId = null;
            if ($credits > 0) {
                $deduction = app(BalanceService::class)->deduct($locked->user, 'credit', $credits, 'usage', 'video ' . $locked->request_id, (string)$locked->request_id);
                $sourcePlanId = $deduction['source_plan_id'] ?? null;
            }
            app(QuotaService::class)->consumeForType($locked->user, 'video', 1);
            $locked->update(['billing_status' => 'charged', 'credits_used' => $credits]);
            $this->recordUsage($locked->fresh(), 'success', $credits, '', $sourcePlanId);
        });
    }

    public function recordUsage(VideoTask $task, string $status, float $credits, string $remark = '', ?int $sourcePlanId = null): void
    {
        VideoUsageRecord::updateOrCreate(
            ['video_task_id' => $task->id],
            [
                'user_id' => $task->user_id,
                'video_model_spec_id' => $task->video_model_spec_id,
                'video_sku_price_id' => $task->video_sku_price_id,
                'provider_key' => $task->provider_key,
                'provider_protocol' => $task->provider_protocol,
                'model_id' => $task->model_id,
                'sku_key' => $task->sku_key,
                'credits_used' => $credits,
                'balance_type' => 'credit',
                'source_plan_id' => $sourcePlanId,
                'status' => $status,
                'request_id' => $task->request_id,
                'remark' => mb_substr($remark, 0, 500),
                'billing_snapshot' => $task->billing_snapshot,
            ]
        );
    }

    public function serializeTask(VideoTask $task, bool $admin = false): array
    {
        $task->loadMissing(['modelSpec', 'sku', 'result']);
        $result = $task->result;
        $data = [
            'id' => $task->id,
            'task_id' => $task->id,
            'provider_key' => $task->provider_key,
            'provider_protocol' => $task->provider_protocol,
            'model_id' => $task->model_id,
            'model_name' => $task->modelSpec?->display_name ?? $task->model_id,
            'sku_key' => $task->sku_key,
            'sku_title' => $task->sku?->title ?? '',
            'status' => $task->status,
            'provider_status' => $task->provider_status,
            'progress' => (int)$task->progress,
            'prompt' => $task->prompt,
            'negative_prompt' => $task->negative_prompt,
            'request_params' => $task->request_params ?: [],
            'input_assets' => $task->input_assets ?: [],
            'billing_status' => $task->billing_status,
            'estimated_credits' => (float)$task->estimated_credits,
            'credits_used' => (float)$task->credits_used,
            'error_code' => $task->error_code,
            'error_message' => $task->error_message,
            'created_at' => $task->created_at,
            'submitted_at' => $task->submitted_at,
            'completed_at' => $task->completed_at,
            'failed_at' => $task->failed_at,
            'result' => $result ? [
                'remote_url' => $result->remote_url,
                'storage_url' => $result->storage_url,
                'video_url' => $result->storage_url ?: $result->remote_url,
                'cover_url' => $result->cover_url,
                'duration_seconds' => (int)$result->duration_seconds,
                'width' => (int)$result->width,
                'height' => (int)$result->height,
                'mime_type' => $result->mime_type,
                'file_size' => (int)$result->file_size,
                'storage_status' => $result->storage_status,
                'metadata' => $result->metadata ?: [],
            ] : null,
        ];

        if ($admin) {
            $data['provider_task_id'] = $task->provider_task_id;
            $data['submit_payload'] = $task->submit_payload ?: [];
            $data['provider_response'] = $task->provider_response ?: [];
            $data['billing_snapshot'] = $task->billing_snapshot ?: [];
            $data['error_summary'] = app(VideoTaskErrorPresenter::class)->present($task->error_message, $task->error_code);
        }

        return $data;
    }

    private function normalizeReferenceAssets(array $payload): array
    {
        $assets = [];
        foreach ((array)($payload['reference_assets'] ?? []) as $asset) {
            if (!is_array($asset)) continue;
            $url = (string)($asset['url'] ?? '');
            if ($url === '' || !preg_match('#^https?://#i', $url)) continue;
            $assetType = (string)($asset['asset_type'] ?? 'image');
            if (!in_array($assetType, ['image', 'video', 'audio'], true)) $assetType = 'image';
            $role = (string)($asset['role'] ?? 'reference');
            if (!in_array($role, ['reference', 'subject', 'scene', 'style', 'first_frame', 'last_frame'], true)) $role = 'reference';
            $assets[] = [
                'id' => $asset['id'] ?? null,
                'asset_type' => $assetType,
                'original_name' => (string)($asset['original_name'] ?? ''),
                'url' => $url,
                'role' => $role,
                'index' => max(1, (int)($asset['index'] ?? (count($assets) + 1))),
                'label' => (string)($asset['label'] ?? ''),
            ];
        }

        if (empty($assets)) {
            $imageIndex = 0;
            foreach ((array)($payload['reference_image_urls'] ?? []) as $url) {
                if (!is_string($url) || !preg_match('#^https?://#i', $url)) continue;
                $imageIndex++;
                $assets[] = [
                    'id' => null,
                    'asset_type' => 'image',
                    'original_name' => '',
                    'url' => $url,
                    'role' => 'reference',
                    'index' => count($assets) + 1,
                    'label' => '参考图' . $imageIndex,
                ];
            }
            $videoIndex = 0;
            foreach ((array)($payload['reference_video_urls'] ?? []) as $url) {
                if (!is_string($url) || !preg_match('#^https?://#i', $url)) continue;
                $videoIndex++;
                $assets[] = [
                    'id' => null,
                    'asset_type' => 'video',
                    'original_name' => '',
                    'url' => $url,
                    'role' => 'reference',
                    'index' => count($assets) + 1,
                    'label' => '参考视频' . $videoIndex,
                ];
            }
            $audioIndex = 0;
            foreach ((array)($payload['reference_audio_urls'] ?? []) as $url) {
                if (!is_string($url) || !preg_match('#^https?://#i', $url)) continue;
                $audioIndex++;
                $assets[] = [
                    'id' => null,
                    'asset_type' => 'audio',
                    'original_name' => '',
                    'url' => $url,
                    'role' => 'reference',
                    'index' => count($assets) + 1,
                    'label' => '参考音频' . $audioIndex,
                ];
            }
        }

        usort($assets, fn($a, $b) => ((int)($a['index'] ?? 0)) <=> ((int)($b['index'] ?? 0)));
        return array_values($assets);
    }

    private function findReferenceAssetByRole(array $assets, string $role): ?array
    {
        foreach ($assets as $asset) {
            if (($asset['role'] ?? '') === $role) return $asset;
        }
        return null;
    }

    private function selectAccount(string $providerKey): VideoProviderAccount
    {
        $account = VideoProviderAccount::where('provider_key', $providerKey)
            ->where('status', 'active')
            ->orderBy('id')
            ->first();
        if (!$account) {
            throw new \RuntimeException('未配置可用的视频服务商账号');
        }
        if (!$account->api_key) {
            throw new \RuntimeException('视频服务商 API Key 为空');
        }
        return $account;
    }

    private function dispatchSubmit(string $taskId): void
    {
        if (config('queue.default', 'sync') === 'sync') {
            app()->terminating(function () use ($taskId) {
                try {
                    app()->call([new ProcessVideoSubmitJob($taskId), 'handle']);
                } catch (\Throwable $e) {
                    Log::error('[ProcessVideoSubmitJob.terminating] ' . $taskId . ': ' . $e->getMessage());
                    VideoTask::where('id', $taskId)->whereNotIn('status', ['completed', 'failed', 'canceled'])->update([
                        'status' => 'failed',
                        'error_message' => 'Job exception: ' . $e->getMessage(),
                        'failed_at' => now(),
                    ]);
                }
            });
        } else {
            ProcessVideoSubmitJob::dispatch($taskId);
        }
    }

    /**
     * 任务自创建 / 提交起是否已超过轮询超时窗口（与 PollVideoTaskJob / SettlePendingVideoTasks 同口径）。
     */
    private function isSubmitExpired(VideoTask $task): bool
    {
        $startedAt = $task->submitted_at ?: $task->created_at;
        $timeoutSeconds = max(300, min(14400, (int) SystemSetting::getValue('video_poll_timeout_seconds', 3600)));
        return $startedAt && $startedAt->copy()->addSeconds($timeoutSeconds)->isPast();
    }
}
