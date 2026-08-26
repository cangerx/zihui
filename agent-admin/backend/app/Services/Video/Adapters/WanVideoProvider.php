<?php

namespace App\Services\Video\Adapters;

use App\Models\VideoProviderAccount;
use App\Models\VideoTask;
use App\Services\Video\VideoProviderInterface;
use App\Services\Video\VideoQueryResult;
use App\Services\Video\VideoSubmitResult;

/**
 * 算力超市 / DashScope 兼容视频：POST /api/v1/tasks，body 为 input.prompt + input.media。
 * 对标 Wan 3.0 Video（首尾帧与参考素材互斥）。
 */
class WanVideoProvider extends AbstractVideoProvider implements VideoProviderInterface
{
    private const SUBMIT_TIMEOUT = 60;
    private const QUERY_TIMEOUT = 30;

    public function submit(VideoTask $task, VideoProviderAccount $account): VideoSubmitResult
    {
        $path = $this->pathFor($task, 'submit');
        $payload = $this->buildSubmitPayload($task);
        $result = $this->request('POST', $this->url($account, $path), $account, $payload, self::SUBMIT_TIMEOUT);

        if ($result['err'] !== '') {
            return VideoSubmitResult::fail($result['err'], 'connection_error', [], $payload);
        }
        if ($result['code'] < 200 || $result['code'] >= 300) {
            return VideoSubmitResult::fail($this->extractError($result['data'], 'Wan 视频任务提交失败'), 'http_' . $result['code'], $result['data'], $payload);
        }
        if ($this->isBusinessError($result['data'])) {
            return VideoSubmitResult::fail($this->extractError($result['data'], 'Wan 视频任务提交失败'), 'provider_error', $result['data'], $payload);
        }

        $providerTaskId = $this->extractTaskId($result['data']);
        if ($providerTaskId === '') {
            return VideoSubmitResult::fail('Wan 视频提交响应缺少任务 ID', 'missing_task_id', $result['data'], $payload);
        }

        return VideoSubmitResult::ok($providerTaskId, $this->extractProviderStatus($result['data'], 'submitted'), $result['data'], $payload);
    }

    public function query(VideoTask $task, VideoProviderAccount $account): VideoQueryResult
    {
        if (!$task->provider_task_id) {
            return VideoQueryResult::fail('任务缺少上游 provider_task_id', 'missing_provider_task_id');
        }

        $path = str_replace('{task_id}', rawurlencode((string) $task->provider_task_id), $this->pathFor($task, 'query'));
        $result = $this->request('GET', $this->url($account, $path), $account, [], self::QUERY_TIMEOUT);

        if ($result['err'] !== '') {
            return VideoQueryResult::fail($result['err'], 'connection_error');
        }
        if ($result['code'] < 200 || $result['code'] >= 300) {
            return VideoQueryResult::fail($this->extractError($result['data'], 'Wan 视频任务查询失败'), 'http_' . $result['code'], $result['data']);
        }

        $providerStatus = $this->extractProviderStatus($result['data'], '');
        $standardStatus = $this->normalizeStatus($providerStatus, $result['data']);
        $progress = $this->extractProgress($result['data'], $standardStatus);
        $videoUrl = $this->extractVideoUrl($result['data']);
        $coverUrl = $this->extractCoverUrl($result['data']);
        $metadata = $this->extractMetadata($result['data'], $task);

        if ($standardStatus === 'failed') {
            return VideoQueryResult::fail($this->extractError($result['data'], 'Wan 视频任务失败'), 'provider_failed', $result['data'], $providerStatus);
        }

        return VideoQueryResult::ok($standardStatus, $providerStatus, $progress, $videoUrl, $coverUrl, $metadata, $result['data']);
    }

    public function cancel(VideoTask $task, VideoProviderAccount $account): VideoQueryResult
    {
        return VideoQueryResult::ok('canceled', 'canceled', (int) $task->progress, '', '', [], ['state' => 'canceled']);
    }

    public function test(VideoProviderAccount $account): array
    {
        if (!$account->api_key) {
            return ['ok' => false, 'message' => '请先填写 API Key'];
        }
        if (trim((string) $account->base_url) === '') {
            return ['ok' => false, 'message' => '请填写 Base URL，例如 https://api.likeadmin.cn'];
        }
        $result = $this->request('GET', $this->url($account, '/api/v1/models'), $account, [], 15);
        if ($result['err'] !== '') {
            return ['ok' => false, 'message' => $result['err']];
        }
        if (in_array($result['code'], [200, 400, 404, 422], true)) {
            return ['ok' => true, 'message' => 'Wan / 算力超市任务接口可达'];
        }
        if ($result['code'] === 401) {
            return ['ok' => false, 'message' => '鉴权失败，请检查 API Key'];
        }
        return ['ok' => false, 'message' => '连接异常，HTTP ' . $result['code']];
    }

    private function buildSubmitPayload(VideoTask $task): array
    {
        $params = $task->request_params ?: [];
        $assets = $this->materializeAssetUrls($task->input_assets ?: []);
        $mode = strtolower((string) ($params['mode'] ?? ''));
        $media = $this->buildMedia($assets, $mode);

        $input = [];
        if ((string) $task->prompt !== '') {
            $input['prompt'] = (string) $task->prompt;
        }
        if ($media !== []) {
            $input['media'] = $media;
        }
        if ($input === []) {
            throw new \InvalidArgumentException('Wan 视频需要提示词或参考素材');
        }

        $duration = (int) ($params['duration'] ?? 0);
        $resolution = $this->normalizeResolution((string) ($params['resolution'] ?? ''));
        $ratio = (string) ($params['aspect_ratio'] ?? $params['ratio'] ?? '');

        $parameters = array_filter([
            'duration' => $duration > 0 ? $duration : null,
            'resolution' => $resolution !== '' ? $resolution : null,
            'ratio' => $ratio !== '' ? $ratio : null,
        ], fn ($v) => $v !== null && $v !== '');

        return array_filter([
            'model' => $task->model_id,
            'input' => $input,
            'parameters' => $parameters !== [] ? $parameters : null,
        ], fn ($v) => $v !== null && $v !== []);
    }

    /**
     * 首尾帧模式只传 first_frame / last_frame；参考图/视频/音频与首尾帧互斥。
     *
     * @return array<int, array{type:string,url:string}>
     */
    private function buildMedia(array $assets, string $mode): array
    {
        $media = [];
        $firstLast = $mode === 'first_last_frame';
        $first = $this->assetByRole($assets, 'first_frame');
        $last = $this->assetByRole($assets, 'last_frame');

        if ($firstLast) {
            if ($first) {
                $media[] = ['type' => 'first_frame', 'url' => (string) $first['url']];
            }
            if ($last) {
                $media[] = ['type' => 'last_frame', 'url' => (string) $last['url']];
            }
            return $media;
        }

        foreach ($this->assetItems($assets) as $asset) {
            $url = (string) ($asset['url'] ?? '');
            if ($url === '') {
                continue;
            }
            $role = strtolower((string) ($asset['role'] ?? ''));
            $type = strtolower((string) ($asset['asset_type'] ?? ''));
            if ($role === 'first_frame') {
                $media[] = ['type' => 'first_frame', 'url' => $url];
                continue;
            }
            if ($role === 'last_frame') {
                $media[] = ['type' => 'last_frame', 'url' => $url];
                continue;
            }
            if ($type === 'video') {
                $media[] = ['type' => 'reference_video', 'url' => $url];
                continue;
            }
            if ($type === 'audio') {
                $media[] = ['type' => 'reference_audio', 'url' => $url];
                continue;
            }
            $media[] = ['type' => 'reference_image', 'url' => $url];
        }
        return $media;
    }

    private function assetItems(array $assets): array
    {
        $items = [];
        if (is_array($assets['assets'] ?? null)) {
            foreach ($assets['assets'] as $asset) {
                if (is_array($asset)) {
                    $items[] = $asset;
                }
            }
            return $items;
        }
        foreach (['images' => 'image', 'videos' => 'video', 'audios' => 'audio'] as $key => $type) {
            foreach ((array) ($assets[$key] ?? []) as $url) {
                if (is_string($url) && $url !== '') {
                    $items[] = ['asset_type' => $type, 'url' => $url];
                }
            }
        }
        return $items;
    }

    private function assetByRole(array $assets, string $role): ?array
    {
        foreach ($this->assetItems($assets) as $asset) {
            if (($asset['role'] ?? '') === $role && !empty($asset['url'])) {
                return $asset;
            }
        }
        return null;
    }

    private function normalizeResolution(string $value): string
    {
        $v = strtoupper(trim($value));
        if ($v === '') {
            return '';
        }
        $v = str_replace(['P', 'K'], '', $v);
        if (in_array($v, ['480', '720', '1080'], true)) {
            return $v . 'P';
        }
        return strtoupper(trim($value));
    }

    private function pathFor(VideoTask $task, string $kind): string
    {
        $params = $task->modelSpec?->provider_params ?: [];
        $key = $kind . '_path';
        if (!empty($params[$key])) {
            return (string) $params[$key];
        }
        return $kind === 'submit' ? '/api/v1/tasks' : '/api/v1/tasks/{task_id}';
    }

    private function extractTaskId(array $data): string
    {
        foreach (['id', 'task_id', 'provider_task_id'] as $key) {
            if (!empty($data[$key]) && is_scalar($data[$key])) {
                return (string) $data[$key];
            }
        }
        foreach (['data', 'result'] as $key) {
            if (isset($data[$key]) && is_array($data[$key])) {
                $id = $this->extractTaskId($data[$key]);
                if ($id !== '') {
                    return $id;
                }
            }
        }
        return '';
    }

    private function extractProviderStatus(array $data, string $fallback): string
    {
        foreach (['status', 'state', 'task_status', 'task_state'] as $key) {
            if (!empty($data[$key]) && is_scalar($data[$key])) {
                return strtolower((string) $data[$key]);
            }
        }
        foreach (['data', 'result', 'output'] as $key) {
            if (isset($data[$key]) && is_array($data[$key])) {
                $status = $this->extractProviderStatus($data[$key], '');
                if ($status !== '') {
                    return $status;
                }
            }
        }
        return $fallback;
    }

    private function normalizeStatus(string $providerStatus, array $data): string
    {
        $s = strtolower($providerStatus);
        if (in_array($s, ['succeeded', 'success', 'succeed', 'completed', 'complete', 'done'], true)) {
            return 'completed';
        }
        if (in_array($s, ['failed', 'error', 'cancelled', 'canceled'], true)) {
            return $s === 'canceled' || $s === 'cancelled' ? 'canceled' : 'failed';
        }
        if ($this->extractVideoUrl($data) !== '') {
            return 'completed';
        }
        return in_array($s, ['pending', 'queued', 'submitted', 'pending_queue'], true) ? 'pending' : 'running';
    }

    private function extractProgress(array $data, string $status): int
    {
        if ($status === 'completed') {
            return 100;
        }
        foreach (['progress', 'percent'] as $key) {
            if (isset($data[$key]) && is_numeric($data[$key])) {
                return max(0, min(99, (int) $data[$key]));
            }
        }
        if (isset($data['data']) && is_array($data['data'])) {
            return $this->extractProgress($data['data'], $status);
        }
        return $status === 'pending' ? 5 : 50;
    }

    private function extractVideoUrl(array $data): string
    {
        foreach (['video_url', 'url', 'output_url', 'remote_url'] as $key) {
            if (!empty($data[$key]) && is_string($data[$key]) && preg_match('#^https?://#i', $data[$key])) {
                return $data[$key];
            }
        }
        foreach (['data', 'result', 'output', 'content'] as $key) {
            if (isset($data[$key]) && is_array($data[$key])) {
                $url = $this->extractVideoUrl($data[$key]);
                if ($url !== '') {
                    return $url;
                }
            }
        }
        if (isset($data['videos']) && is_array($data['videos'])) {
            foreach ($data['videos'] as $video) {
                if (is_array($video)) {
                    $url = $this->extractVideoUrl($video);
                    if ($url !== '') {
                        return $url;
                    }
                } elseif (is_string($video) && preg_match('#^https?://#i', $video)) {
                    return $video;
                }
            }
        }
        return '';
    }

    private function extractCoverUrl(array $data): string
    {
        foreach (['cover_url', 'thumbnail_url', 'poster_url'] as $key) {
            if (!empty($data[$key]) && is_string($data[$key])) {
                return $data[$key];
            }
        }
        foreach (['data', 'result', 'output'] as $key) {
            if (isset($data[$key]) && is_array($data[$key])) {
                $url = $this->extractCoverUrl($data[$key]);
                if ($url !== '') {
                    return $url;
                }
            }
        }
        return '';
    }

    private function extractMetadata(array $data, VideoTask $task): array
    {
        $nested = is_array($data['data'] ?? null) ? $data['data'] : $data;
        return [
            'duration_seconds' => (int) ($nested['duration'] ?? $nested['duration_seconds'] ?? $task->request_params['duration'] ?? 0),
            'width' => (int) ($nested['width'] ?? 0),
            'height' => (int) ($nested['height'] ?? 0),
            'mime_type' => 'video/mp4',
            'raw_keys' => array_keys($data),
        ];
    }

    private function extractError(array $data, string $fallback): string
    {
        foreach (['msg', 'message', 'error_message', 'description'] as $key) {
            if (!empty($data[$key]) && is_scalar($data[$key])) {
                return (string) $data[$key];
            }
        }
        if (isset($data['error'])) {
            if (is_string($data['error'])) {
                return $data['error'];
            }
            if (is_array($data['error'])) {
                return $this->extractError($data['error'], $fallback);
            }
        }
        if (isset($data['data']) && is_array($data['data'])) {
            return $this->extractError($data['data'], $fallback);
        }
        return $fallback;
    }
}
