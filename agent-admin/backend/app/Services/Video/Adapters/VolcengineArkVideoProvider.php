<?php

namespace App\Services\Video\Adapters;

use App\Models\VideoProviderAccount;
use App\Models\VideoTask;
use App\Services\Video\VideoProviderInterface;
use App\Services\Video\VideoQueryResult;
use App\Services\Video\VideoSubmitResult;

/**
 * 火山方舟官方视频生成：POST/GET /api/v3/contents/generations/tasks。
 * 默认华北 https://ark.cn-beijing.volces.com，Bearer API Key。
 */
class VolcengineArkVideoProvider extends AbstractVideoProvider implements VideoProviderInterface
{
    private const SUBMIT_TIMEOUT = 60;
    private const QUERY_TIMEOUT = 30;
    public const DEFAULT_BASE = 'https://ark.cn-beijing.volces.com';

    public function submit(VideoTask $task, VideoProviderAccount $account): VideoSubmitResult
    {
        try {
            $payload = VolcengineArkPayload::build(
                (string) $task->model_id,
                (string) $task->prompt,
                is_array($task->request_params) ? $task->request_params : [],
                $this->materializeAssetUrls(is_array($task->input_assets) ? $task->input_assets : [])
            );
        } catch (\InvalidArgumentException $e) {
            return VideoSubmitResult::fail($e->getMessage(), 'invalid_params');
        }

        $result = $this->request('POST', $this->url($account, $this->submitPath($task)), $account, $payload, self::SUBMIT_TIMEOUT);
        if ($result['err'] !== '') {
            return VideoSubmitResult::fail($result['err'], 'connection_error', [], $payload);
        }
        if ($result['code'] < 200 || $result['code'] >= 300 || $this->isBusinessError($result['data'])) {
            return VideoSubmitResult::fail($this->extractError($result['data'], '火山方舟提交失败'), $this->httpErrorCode($result['code'], $result['data']), $result['data'], $payload);
        }

        $providerTaskId = $this->extractTaskId($result['data']);
        if ($providerTaskId === '') {
            return VideoSubmitResult::fail('火山方舟提交响应缺少任务 ID', 'missing_task_id', $result['data'], $payload);
        }

        return VideoSubmitResult::ok($providerTaskId, 'queued', $result['data'], $payload);
    }

    public function query(VideoTask $task, VideoProviderAccount $account): VideoQueryResult
    {
        if (!$task->provider_task_id) {
            return VideoQueryResult::fail('任务缺少上游 provider_task_id', 'missing_provider_task_id');
        }

        $path = str_replace('{task_id}', rawurlencode((string) $task->provider_task_id), $this->queryPath($task));
        $result = $this->request('GET', $this->url($account, $path), $account, [], self::QUERY_TIMEOUT);
        if ($result['err'] !== '') {
            return VideoQueryResult::fail($result['err'], 'connection_error');
        }
        if ($result['code'] < 200 || $result['code'] >= 300 || $this->isBusinessError($result['data'])) {
            return VideoQueryResult::fail($this->extractError($result['data'], '火山方舟查询失败'), $this->httpErrorCode($result['code'], $result['data']), $result['data']);
        }

        $providerStatus = $this->extractStatus($result['data'], '');
        $standardStatus = $this->normalizeStatus($providerStatus, $result['data']);
        if ($standardStatus === 'failed') {
            return VideoQueryResult::fail($this->extractError($result['data'], '火山方舟任务失败'), 'provider_failed', $result['data'], $providerStatus);
        }

        return VideoQueryResult::ok(
            $standardStatus,
            $providerStatus,
            $this->extractProgress($result['data'], $standardStatus),
            $this->extractVideoUrl($result['data']),
            $this->extractCoverUrl($result['data']),
            $this->extractMetadata($result['data']),
            $result['data']
        );
    }

    public function cancel(VideoTask $task, VideoProviderAccount $account): VideoQueryResult
    {
        if ($task->provider_task_id) {
            $path = str_replace('{task_id}', rawurlencode((string) $task->provider_task_id), $this->queryPath($task));
            $this->request('DELETE', $this->url($account, $path), $account, [], 15);
        }
        return VideoQueryResult::ok('canceled', 'cancelled', (int) $task->progress, '', '', [], ['state' => 'canceled']);
    }

    public function test(VideoProviderAccount $account): array
    {
        if (trim((string) $account->api_key) === '') {
            return ['ok' => false, 'message' => '请先填写火山方舟 API Key'];
        }
        if (trim((string) $account->base_url) === '') {
            return ['ok' => false, 'message' => '请填写 Base URL，例如 ' . self::DEFAULT_BASE];
        }

        $result = $this->request('GET', $this->url($account, '/api/v3/contents/generations/tasks?page_size=1'), $account, [], 15);
        if ($result['err'] !== '') {
            return ['ok' => false, 'message' => $result['err']];
        }
        if (in_array($result['code'], [401, 403], true)) {
            return ['ok' => false, 'message' => '鉴权失败，请检查火山方舟 API Key'];
        }
        if (in_array($result['code'], [200, 400, 404, 422], true)) {
            return ['ok' => true, 'message' => '火山方舟视频接口可达'];
        }
        return ['ok' => false, 'message' => '连接异常，HTTP ' . $result['code']];
    }

    /**
     * @return list<array{id:string,name:string}>
     */
    public function fetchModels(VideoProviderAccount $account): array
    {
        $probe = $this->test($account);
        if (!($probe['ok'] ?? false)) {
            throw new \RuntimeException((string) ($probe['message'] ?? '无法连接火山方舟'));
        }
        return [
            ['id' => 'doubao-seedance-2-0-260128', 'name' => 'Seedance 2.0'],
            ['id' => 'doubao-seedance-2-0-fast-260128', 'name' => 'Seedance 2.0 Fast'],
            ['id' => 'doubao-seedance-2-5', 'name' => 'Seedance 2.5'],
        ];
    }

    private function submitPath(VideoTask $task): string
    {
        $params = $task->modelSpec?->provider_params ?: [];
        return ((string) ($params['submit_path'] ?? '')) ?: '/api/v3/contents/generations/tasks';
    }

    private function queryPath(VideoTask $task): string
    {
        $params = $task->modelSpec?->provider_params ?: [];
        return ((string) ($params['query_path'] ?? '')) ?: '/api/v3/contents/generations/tasks/{task_id}';
    }

    private function extractTaskId(array $data): string
    {
        foreach (['id', 'task_id'] as $key) {
            if (!empty($data[$key]) && is_scalar($data[$key])) {
                return (string) $data[$key];
            }
        }
        return '';
    }

    private function extractStatus(array $data, string $fallback): string
    {
        foreach (['status', 'state'] as $key) {
            if (!empty($data[$key]) && is_scalar($data[$key])) {
                return strtolower((string) $data[$key]);
            }
        }
        return $fallback;
    }

    private function normalizeStatus(string $status, array $data): string
    {
        $s = strtolower($status);
        if (in_array($s, ['completed', 'complete', 'succeeded', 'success', 'done'], true)) {
            return 'completed';
        }
        if (in_array($s, ['failed', 'error', 'expired'], true)) {
            return 'failed';
        }
        if (in_array($s, ['cancelled', 'canceled'], true)) {
            return 'canceled';
        }
        if ($this->extractVideoUrl($data) !== '') {
            return 'completed';
        }
        if (in_array($s, ['queued', 'pending', 'created', 'submitted'], true)) {
            return 'pending';
        }
        return 'running';
    }

    private function extractProgress(array $data, string $status): int
    {
        if ($status === 'completed') {
            return 100;
        }
        if (isset($data['progress']) && is_numeric($data['progress'])) {
            return max(0, min(99, (int) round((float) $data['progress'])));
        }
        return $status === 'pending' ? 5 : 50;
    }

    private function extractVideoUrl(array $data): string
    {
        $content = is_array($data['content'] ?? null) ? $data['content'] : [];
        foreach ([$content['video_url'] ?? null, $content['url'] ?? null, $data['video_url'] ?? null] as $url) {
            if (is_string($url) && preg_match('#^https?://#i', $url)) {
                return $url;
            }
        }
        return '';
    }

    private function extractCoverUrl(array $data): string
    {
        $content = is_array($data['content'] ?? null) ? $data['content'] : [];
        foreach (['last_frame_url', 'cover_url', 'thumbnail_url'] as $key) {
            if (!empty($content[$key]) && is_string($content[$key])) {
                return $content[$key];
            }
            if (!empty($data[$key]) && is_string($data[$key])) {
                return $data[$key];
            }
        }
        return '';
    }

    /**
     * @return array<string, mixed>
     */
    private function extractMetadata(array $data): array
    {
        return array_filter([
            'resolution' => $data['resolution'] ?? null,
            'duration' => $data['duration'] ?? null,
            'ratio' => $data['ratio'] ?? null,
            'usage' => $data['usage'] ?? null,
        ], fn ($v) => $v !== null && $v !== '');
    }

    private function extractError(array $data, string $fallback): string
    {
        $error = is_array($data['error'] ?? null) ? $data['error'] : [];
        foreach ([
            $error['message'] ?? null,
            $data['message'] ?? null,
        ] as $message) {
            if (is_string($message) && trim($message) !== '') {
                return $message;
            }
        }
        return $fallback;
    }

    private function httpErrorCode(int $http, array $data): string
    {
        $code = (string) ($data['error']['code'] ?? '');
        if ($code !== '') {
            return $code;
        }
        return $http > 0 ? 'http_' . $http : 'provider_error';
    }
}
