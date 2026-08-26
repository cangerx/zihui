<?php

namespace App\Services\Video\Adapters;

use App\Models\VideoProviderAccount;
use App\Models\VideoTask;
use App\Services\Video\VideoProviderInterface;
use App\Services\Video\VideoQueryResult;
use App\Services\Video\VideoSubmitResult;

/**
 * MiniMax H3 V2：POST /v2/video_generation，GET /v2/query/video_generation/{task_id}。
 * 默认国内站 https://api.minimaxi.com；国际站可改 Base URL 为 https://api.minimax.io。
 */
class MiniMaxH3VideoProvider extends AbstractVideoProvider implements VideoProviderInterface
{
    private const SUBMIT_TIMEOUT = 60;
    private const QUERY_TIMEOUT = 30;
    private const DEFAULT_BASE = 'https://api.minimaxi.com';

    public function submit(VideoTask $task, VideoProviderAccount $account): VideoSubmitResult
    {
        try {
            $payload = MiniMaxH3Payload::build(
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
            return VideoSubmitResult::fail($this->extractError($result['data'], 'MiniMax H3 提交失败'), $this->httpErrorCode($result['code'], $result['data']), $result['data'], $payload);
        }

        $providerTaskId = $this->extractTaskId($result['data']);
        if ($providerTaskId === '') {
            return VideoSubmitResult::fail('MiniMax H3 提交响应缺少任务 ID', 'missing_task_id', $result['data'], $payload);
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
            return VideoQueryResult::fail($this->extractError($result['data'], 'MiniMax H3 查询失败'), $this->httpErrorCode($result['code'], $result['data']), $result['data']);
        }

        $taskBody = is_array($result['data']['task'] ?? null) ? $result['data']['task'] : $result['data'];
        $providerStatus = $this->extractStatus($taskBody, '');
        $standardStatus = $this->normalizeStatus($providerStatus, $taskBody);
        if ($standardStatus === 'failed') {
            return VideoQueryResult::fail($this->extractError($taskBody, 'MiniMax H3 任务失败'), 'provider_failed', $result['data'], $providerStatus);
        }

        return VideoQueryResult::ok(
            $standardStatus,
            $providerStatus,
            $this->extractProgress($taskBody, $standardStatus),
            $this->extractVideoUrl($taskBody),
            $this->extractCoverUrl($taskBody),
            $this->extractMetadata($taskBody),
            $result['data']
        );
    }

    public function cancel(VideoTask $task, VideoProviderAccount $account): VideoQueryResult
    {
        return VideoQueryResult::ok('canceled', 'cancelled', (int) $task->progress, '', '', [], ['state' => 'canceled']);
    }

    public function test(VideoProviderAccount $account): array
    {
        if (trim((string) $account->api_key) === '') {
            return ['ok' => false, 'message' => '请先填写 API Key'];
        }
        if (trim((string) $account->base_url) === '') {
            return ['ok' => false, 'message' => '请填写 Base URL，例如 ' . self::DEFAULT_BASE];
        }

        $result = $this->request('GET', $this->url($account, '/v2/query/video_generation/0'), $account, [], 15);
        if ($result['err'] !== '') {
            return ['ok' => false, 'message' => $result['err']];
        }
        if (in_array($result['code'], [401, 403], true)) {
            return ['ok' => false, 'message' => '鉴权失败，请检查 API Key'];
        }
        if (in_array($result['code'], [200, 400, 404, 422], true)) {
            return ['ok' => true, 'message' => 'MiniMax H3 接口可达'];
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
            throw new \RuntimeException((string) ($probe['message'] ?? '无法连接 MiniMax'));
        }
        return [['id' => MiniMaxH3Payload::MODEL, 'name' => 'MiniMax H3']];
    }

    private function submitPath(VideoTask $task): string
    {
        $params = $task->modelSpec?->provider_params ?: [];
        return ((string) ($params['submit_path'] ?? '')) ?: '/v2/video_generation';
    }

    private function queryPath(VideoTask $task): string
    {
        $params = $task->modelSpec?->provider_params ?: [];
        return ((string) ($params['query_path'] ?? '')) ?: '/v2/query/video_generation/{task_id}';
    }

    private function extractTaskId(array $data): string
    {
        foreach (['task_id', 'id'] as $key) {
            if (!empty($data[$key]) && is_scalar($data[$key])) {
                return (string) $data[$key];
            }
        }
        if (isset($data['task']) && is_array($data['task'])) {
            return $this->extractTaskId($data['task']);
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
        if (in_array($s, ['failed', 'error'], true)) {
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
        foreach ([$content['url'] ?? null, $data['video_url'] ?? null, $data['url'] ?? null] as $url) {
            if (is_string($url) && preg_match('#^https?://#i', $url)) {
                return $url;
            }
        }
        return '';
    }

    private function extractCoverUrl(array $data): string
    {
        $content = is_array($data['content'] ?? null) ? $data['content'] : [];
        foreach (['cover_url', 'thumbnail_url', 'poster_url'] as $key) {
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
        $task = is_array($data['task'] ?? null) ? $data['task'] : [];
        $error = is_array($data['error'] ?? $task['error'] ?? null) ? ($data['error'] ?? $task['error']) : [];
        foreach ([
            $error['message'] ?? null,
            $data['error']['message'] ?? null,
            $data['base_resp']['status_msg'] ?? null,
            $task['error']['message'] ?? null,
        ] as $message) {
            if (is_string($message) && trim($message) !== '') {
                return $message;
            }
        }
        return $fallback;
    }

    private function httpErrorCode(int $http, array $data): string
    {
        $type = (string) ($data['error']['type'] ?? '');
        if ($type !== '') {
            return $type;
        }
        return $http > 0 ? 'http_' . $http : 'provider_error';
    }
}
