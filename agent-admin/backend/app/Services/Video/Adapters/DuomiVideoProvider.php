<?php

namespace App\Services\Video\Adapters;

use App\Models\VideoProviderAccount;
use App\Models\VideoTask;
use App\Services\Video\VideoProviderInterface;
use App\Services\Video\VideoQueryResult;
use App\Services\Video\VideoSubmitResult;

class DuomiVideoProvider extends AbstractVideoProvider implements VideoProviderInterface
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
            return VideoSubmitResult::fail($this->extractError($result['data'], '多米视频任务提交失败'), 'http_' . $result['code'], $result['data'], $payload);
        }

        $providerTaskId = $this->extractTaskId($result['data']);
        if ($providerTaskId === '') {
            if ($this->isBusinessError($result['data'])) {
                return VideoSubmitResult::fail($this->extractError($result['data'], '多米视频任务提交失败'), 'provider_error', $result['data'], $payload);
            }
            return VideoSubmitResult::fail('多米视频提交响应缺少任务 ID', 'missing_task_id', $result['data'], $payload);
        }

        return VideoSubmitResult::ok($providerTaskId, $this->extractProviderStatus($result['data'], 'submitted'), $result['data'], $payload);
    }

    public function query(VideoTask $task, VideoProviderAccount $account): VideoQueryResult
    {
        if (!$task->provider_task_id) {
            return VideoQueryResult::fail('任务缺少上游 provider_task_id', 'missing_provider_task_id');
        }

        $path = str_replace('{task_id}', rawurlencode((string)$task->provider_task_id), $this->pathFor($task, 'query'));
        $result = $this->request('GET', $this->url($account, $path), $account, [], self::QUERY_TIMEOUT);

        if ($result['err'] !== '') {
            return VideoQueryResult::fail($result['err'], 'connection_error');
        }
        if ($result['code'] < 200 || $result['code'] >= 300) {
            return VideoQueryResult::fail($this->extractError($result['data'], '多米视频任务查询失败'), 'http_' . $result['code'], $result['data']);
        }

        $providerStatus = $this->extractProviderStatus($result['data'], '');
        $standardStatus = $this->normalizeStatus($providerStatus, $result['data']);
        $progress = $this->extractProgress($result['data'], $standardStatus);
        $videoUrl = $this->extractVideoUrl($result['data']);
        $coverUrl = $this->extractCoverUrl($result['data']);
        $metadata = $this->extractMetadata($result['data'], $task);

        if ($standardStatus === 'failed') {
            return VideoQueryResult::fail($this->extractError($result['data'], '多米视频任务失败'), 'provider_failed', $result['data'], $providerStatus);
        }

        return VideoQueryResult::ok($standardStatus, $providerStatus, $progress, $videoUrl, $coverUrl, $metadata, $result['data']);
    }

    public function cancel(VideoTask $task, VideoProviderAccount $account): VideoQueryResult
    {
        return VideoQueryResult::ok('canceled', 'canceled', (int)$task->progress, '', '', [], ['state' => 'canceled']);
    }

    public function test(VideoProviderAccount $account): array
    {
        if (!$account->api_key) {
            return ['ok' => false, 'message' => '请先填写 API Key'];
        }
        $result = $this->request('GET', $this->url($account, '/v1/videos/tasks/__probe__'), $account, [], 15);
        if ($result['err'] !== '') {
            return ['ok' => false, 'message' => $result['err']];
        }
        if (in_array($result['code'], [200, 400, 404, 422], true)) {
            return ['ok' => true, 'message' => '多米视频 API 可达，鉴权格式已通过基础探测'];
        }
        if ($result['code'] === 401) {
            return ['ok' => false, 'message' => '鉴权失败，请检查 API Key'];
        }
        return ['ok' => false, 'message' => '连接异常，HTTP ' . $result['code']];
    }

    private function buildSubmitPayload(VideoTask $task): array
    {
        $params = $task->request_params ?: [];
        // 交上游前把参考素材 URL 换成上游可直拉的 URL（cos/oss 私有桶预签名兜底，见基类）
        $assets = $this->materializeAssetUrls($task->input_assets ?: []);
        $imageUrls = $this->assetUrls($assets, 'image');
        $videoUrls = $this->assetUrls($assets, 'video');
        $audioUrls = $this->assetUrls($assets, 'audio');
        $protocol = (string)$task->provider_protocol;

        if ($protocol === 'seedance') {
            $content = [];
            if ((string)$task->prompt !== '') {
                $content[] = ['type' => 'text', 'text' => (string)$task->prompt];
            }
            foreach ($imageUrls as $url) {
                if (is_string($url) && $url !== '') {
                    $content[] = ['type' => 'image_url', 'image_url' => ['url' => $url], 'role' => 'reference_image'];
                }
            }
            foreach ($videoUrls as $url) {
                if (is_string($url) && $url !== '') {
                    $content[] = ['type' => 'video_url', 'video_url' => ['url' => $url], 'role' => 'reference_video'];
                }
            }
            foreach ($audioUrls as $url) {
                if (is_string($url) && $url !== '') {
                    $content[] = ['type' => 'audio_url', 'audio_url' => ['url' => $url], 'role' => 'reference_audio'];
                }
            }
            return array_filter([
                'model' => $task->model_id,
                'content' => $content,
                'duration' => (int)($params['duration'] ?? 0) ?: null,
                'resolution' => $params['resolution'] ?? null,
                'ratio' => $params['aspect_ratio'] ?? null,
                'callback_url' => $params['callback_url'] ?? null,
            ], fn($v) => $v !== null && $v !== []);
        }

        if ($protocol === 'veo') {
            return $this->buildVeoSubmitPayload($task, $params, $assets);
        }

        if ($protocol === 'grok') {
            return $this->buildGrokSubmitPayload($task, $params, $assets);
        }

        if ($protocol === 'kling') {
            return $this->buildKlingSubmitPayload($task, $params, $assets);
        }

        $payload = [
            'model' => $task->model_id,
            'prompt' => (string)$task->prompt,
        ];
        if ((string)$task->negative_prompt !== '') $payload['negative_prompt'] = (string)$task->negative_prompt;
        if (!empty($params['mode'])) $payload['mode'] = $params['mode'];
        if (!empty($params['duration'])) $payload['duration'] = (int)$params['duration'];
        if (!empty($params['resolution'])) $payload['resolution'] = $params['resolution'];
        if (!empty($params['aspect_ratio'])) $payload['aspect_ratio'] = $params['aspect_ratio'];
        if (!empty($imageUrls)) $payload['image_urls'] = $imageUrls;
        if (!empty($params['callback_url'])) $payload['callback_url'] = $params['callback_url'];
        if ($protocol === 'grok' && !empty($imageUrls)) $payload['images'] = $imageUrls;

        return $payload;
    }

    private function buildVeoSubmitPayload(VideoTask $task, array $params, array $assets): array
    {
        $payload = [
            'model' => $task->model_id,
            'prompt' => (string)$task->prompt,
        ];
        if (!empty($params['aspect_ratio'])) $payload['aspect_ratio'] = $params['aspect_ratio'];
        if (!empty($params['duration'])) $payload['duration'] = (int)$params['duration'];
        if (!empty($params['resolution'])) $payload['quality'] = $params['resolution'];
        $generationType = $this->mapVeoGenerationType((string)($params['mode'] ?? ''));
        if ($generationType !== '') $payload['generation_type'] = $generationType;
        $imageUrls = $this->assetUrls($assets, 'image');
        if (($params['mode'] ?? '') === 'first_last_frame') {
            $firstFrame = $this->assetByRole($assets, 'first_frame');
            $lastFrame = $this->assetByRole($assets, 'last_frame');
            $frameUrls = [];
            if ($firstFrame) $frameUrls[] = $firstFrame['url'];
            if ($lastFrame) $frameUrls[] = $lastFrame['url'];
            if (empty($frameUrls)) {
                $frameUrls = array_slice($imageUrls, 0, 2);
            }
            if (empty($frameUrls)) {
                throw new \InvalidArgumentException('首尾帧模式缺少图片');
            }
            $imageUrls = $frameUrls;
        }
        if (!empty($imageUrls)) $payload['image_urls'] = $imageUrls;
        if (!empty($params['callback_url'])) $payload['callback_url'] = $params['callback_url'];
        return $payload;
    }

    private function buildGrokSubmitPayload(VideoTask $task, array $params, array $assets): array
    {
        $payload = [
            'model' => $task->model_id,
            'prompt' => (string)$task->prompt,
        ];
        if (!empty($params['aspect_ratio'])) $payload['aspect_ratio'] = $params['aspect_ratio'];
        if (!empty($params['duration'])) $payload['duration'] = (int)$params['duration'];
        if (!empty($params['resolution'])) $payload['quality'] = $params['resolution'];
        $imageUrls = $this->assetUrls($assets, 'image');
        if (!empty($imageUrls)) $payload['image_urls'] = $imageUrls;
        if (!empty($params['callback_url'])) $payload['callback_url'] = $params['callback_url'];
        return $payload;
    }

    /**
     * 可灵 Kling「官方格式-推荐」请求体（doc/65 文生 · doc/66 图生 · Apifox 完整 schema）。
     * 提交 endpoint 按文生/图生分流（见 klingPath），body 字段严格对齐多米官方格式：
     *   model_name / prompt / mode(std=720p·pro=1080p,必填) / sound(音画同步) / duration(3-15) /
     *   negative_prompt / cfg_scale(0-1) / image(图生首帧) / image_tail(首尾帧尾帧) / aspect_ratio(文生) / callback_url。
     */
    private function buildKlingSubmitPayload(VideoTask $task, array $params, array $assets): array
    {
        $extra = $task->modelSpec?->provider_params ?: [];
        $imageUrls = $this->assetUrls($assets, 'image');
        $isImage = $this->klingIsImageToVideo($task);

        $payload = [
            'model_name' => $task->model_id,
            'prompt' => (string)$task->prompt,
            // 官方必填：std=720p / pro=1080p
            'mode' => ((string)($params['resolution'] ?? '') === '1080p') ? 'pro' : 'std',
        ];

        // 音画同步（显著影响计费，不放开给用户随选）：由 provider_params.sound 控制，缺省 off
        $sound = strtolower(trim((string)($extra['sound'] ?? 'off')));
        $payload['sound'] = in_array($sound, ['on', 'off'], true) ? $sound : 'off';

        $duration = (int)($params['duration'] ?? 0);
        if ($duration > 0) {
            $payload['duration'] = $duration;
        }

        if ((string)$task->negative_prompt !== '') {
            $payload['negative_prompt'] = (string)$task->negative_prompt;
        }

        // cfg_scale（创意相关度 0-1）可选：UI 未采集，仅当 provider_params 配了默认值才发
        if (isset($extra['cfg_scale']) && is_numeric($extra['cfg_scale'])) {
            $payload['cfg_scale'] = (float)$extra['cfg_scale'];
        }

        if ($isImage) {
            // 图生视频：首帧 image 必填；首尾帧模式再带 image_tail 尾帧
            if ((string)($params['mode'] ?? '') === 'first_last_frame') {
                $first = $this->assetByRole($assets, 'first_frame');
                $last = $this->assetByRole($assets, 'last_frame');
                $firstUrl = (string)($first['url'] ?? ($imageUrls[0] ?? ''));
                $lastUrl = (string)($last['url'] ?? ($imageUrls[1] ?? ''));
                if ($firstUrl !== '') {
                    $payload['image'] = $firstUrl;
                }
                if ($lastUrl !== '') {
                    $payload['image_tail'] = $lastUrl;
                }
            } elseif (!empty($imageUrls)) {
                $payload['image'] = $imageUrls[0];
            }
        } elseif (!empty($params['aspect_ratio'])) {
            // 文生视频：画面比例（16:9/9:16/1:1）；图生比例跟随输入图，不发
            $payload['aspect_ratio'] = (string)$params['aspect_ratio'];
        }

        if (!empty($params['callback_url'])) {
            $payload['callback_url'] = $params['callback_url'];
        }

        return $payload;
    }

    /**
     * 可灵任务是否走图生视频端点（有参考图 / 图生 / 首尾帧模式）。submit 与 query 用同一判定，
     * 保证提交与查询命中同一 endpoint（官方 text2video / image2video 是两个独立 endpoint）。
     */
    private function klingIsImageToVideo(VideoTask $task): bool
    {
        $mode = (string)($task->request_params['mode'] ?? '');
        if (in_array($mode, ['image_to_video', 'first_last_frame'], true)) {
            return true;
        }
        return !empty($this->assetUrls($task->input_assets ?: [], 'image'));
    }

    /**
     * 可灵官方格式路径：文生 /api/video/kling/v1/videos/text2video，图生 .../image2video；
     * 查询用同 endpoint + /{task_id}（task_id 在 path，见 doc Apifox 查询任务）。
     */
    private function klingPath(VideoTask $task, string $kind): string
    {
        $type = $this->klingIsImageToVideo($task) ? 'image2video' : 'text2video';
        $base = '/api/video/kling/v1/videos/' . $type;
        return $kind === 'submit' ? $base : $base . '/{task_id}';
    }

    private function assetUrls(array $assets, string $assetType): array
    {
        $items = is_array($assets['assets'] ?? null) ? $assets['assets'] : [];
        if (!empty($items)) {
            usort($items, fn($a, $b) => ((int)($a['index'] ?? 0)) <=> ((int)($b['index'] ?? 0)));
            return array_values(array_filter(array_map(function ($asset) use ($assetType) {
                if (!is_array($asset) || ($asset['asset_type'] ?? '') !== $assetType) return null;
                $url = (string)($asset['url'] ?? '');
                return $url !== '' ? $url : null;
            }, $items)));
        }
        $key = $assetType === 'video' ? 'videos' : ($assetType === 'audio' ? 'audios' : 'images');
        return array_values(array_filter((array)($assets[$key] ?? [])));
    }

    private function assetByRole(array $assets, string $role): ?array
    {
        foreach ((array)($assets['assets'] ?? []) as $asset) {
            if (is_array($asset) && ($asset['role'] ?? '') === $role && !empty($asset['url'])) {
                return $asset;
            }
        }
        return null;
    }

    private function mapVeoGenerationType(string $mode): string
    {
        return match ($mode) {
            'text_to_video' => 'TEXT',
            'image_to_video' => 'REFERENCE',
            'first_last_frame' => 'FIRST&LAST',
            default => '',
        };
    }

    private function pathFor(VideoTask $task, string $kind): string
    {
        $params = $task->modelSpec?->provider_params ?: [];
        $key = $kind . '_path';
        if (!empty($params[$key])) return (string)$params[$key];

        return match ((string)$task->provider_protocol) {
            'seedance' => $kind === 'submit' ? '/api/v3/contents/generations/tasks' : '/api/v3/contents/generations/tasks/{task_id}',
            'kling' => $this->klingPath($task, $kind),
            // veo / grok 及未知协议统一走多米通用视频接口（未知协议兜底，避免直接抛异常导致 submit_exception）
            default => $kind === 'submit' ? '/v1/videos/generations' : '/v1/videos/tasks/{task_id}',
        };
    }

    /**
     * 覆盖基类：保留多米默认 base_url 兜底（账号未配置 base_url 时回退 duomiapi.com）。
     */
    protected function url(VideoProviderAccount $account, string $path): string
    {
        return rtrim((string)$account->base_url ?: 'https://duomiapi.com', '/') . '/' . ltrim($path, '/');
    }

    /**
     * 多米固定 raw 鉴权风格（Authorization: {key}，不加 Bearer），同时复用基类
     * request() 的 verify_ssl / proxy / extra_headers 能力。
     */
    protected function buildHeaders(VideoProviderAccount $account): array
    {
        $headers = ['Accept: application/json'];
        $apiKey = (string)$account->api_key;
        if ($apiKey !== '') {
            $headers[] = 'Authorization: ' . $apiKey;
        }

        $config = is_array($account->config) ? $account->config : [];
        $extra = $config['extra_headers'] ?? [];
        if (is_array($extra)) {
            foreach ($extra as $key => $value) {
                if (is_string($key) && $key !== '' && (is_string($value) || is_numeric($value))) {
                    $headers[] = $key . ': ' . $value;
                }
            }
        }

        return $headers;
    }

    private function extractTaskId(array $data): string
    {
        foreach (['id', 'task_id', 'provider_task_id'] as $key) {
            if (!empty($data[$key]) && is_scalar($data[$key])) return (string)$data[$key];
        }
        foreach (['data', 'result'] as $key) {
            if (isset($data[$key]) && is_array($data[$key])) {
                $id = $this->extractTaskId($data[$key]);
                if ($id !== '') return $id;
            }
        }
        return '';
    }

    private function extractProviderStatus(array $data, string $fallback): string
    {
        foreach (['status', 'state', 'task_status'] as $key) {
            if (!empty($data[$key]) && is_scalar($data[$key])) return strtolower((string)$data[$key]);
        }
        foreach (['data', 'result'] as $key) {
            if (isset($data[$key]) && is_array($data[$key])) {
                $status = $this->extractProviderStatus($data[$key], '');
                if ($status !== '') return $status;
            }
        }
        return $fallback;
    }

    private function normalizeStatus(string $providerStatus, array $data): string
    {
        $s = strtolower($providerStatus);
        // 'succeed' 为可灵官方格式的成功态（无 -ed），与通用 succeeded/success 并列
        if (in_array($s, ['succeeded', 'success', 'succeed', 'completed', 'complete', 'done'], true)) return 'completed';
        if (in_array($s, ['failed', 'error', 'cancelled', 'canceled'], true)) return $s === 'canceled' || $s === 'cancelled' ? 'canceled' : 'failed';
        if ($this->extractVideoUrl($data) !== '') return 'completed';
        return in_array($s, ['pending', 'queued', 'submitted'], true) ? 'pending' : 'running';
    }

    private function extractProgress(array $data, string $status): int
    {
        if ($status === 'completed') return 100;
        foreach (['progress', 'percent'] as $key) {
            if (isset($data[$key]) && is_numeric($data[$key])) return max(0, min(99, (int)$data[$key]));
        }
        return $status === 'pending' ? 5 : 50;
    }

    private function extractVideoUrl(array $data): string
    {
        foreach (['video_url', 'url', 'output_url', 'remote_url'] as $key) {
            if (!empty($data[$key]) && is_string($data[$key]) && preg_match('#^https?://#i', $data[$key])) return $data[$key];
        }
        // task_result 为可灵官方格式的结果容器（data.task_result.videos[].url）
        foreach (['data', 'result', 'output', 'content', 'task_result'] as $key) {
            if (isset($data[$key]) && is_array($data[$key])) {
                $url = $this->extractVideoUrl($data[$key]);
                if ($url !== '') return $url;
            }
        }
        if (isset($data['videos']) && is_array($data['videos'])) {
            foreach ($data['videos'] as $video) {
                if (is_array($video)) {
                    $url = $this->extractVideoUrl($video);
                    if ($url !== '') return $url;
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
            if (!empty($data[$key]) && is_string($data[$key])) return $data[$key];
        }
        foreach (['data', 'result', 'output'] as $key) {
            if (isset($data[$key]) && is_array($data[$key])) {
                $url = $this->extractCoverUrl($data[$key]);
                if ($url !== '') return $url;
            }
        }
        return '';
    }

    private function extractMetadata(array $data, VideoTask $task): array
    {
        return [
            'duration_seconds' => (int)($data['duration'] ?? $data['duration_seconds'] ?? $task->request_params['duration'] ?? 0),
            'width' => (int)($data['width'] ?? 0),
            'height' => (int)($data['height'] ?? 0),
            'mime_type' => 'video/mp4',
            'raw_keys' => array_keys($data),
        ];
    }

    private function extractError(array $data, string $fallback): string
    {
        foreach (['msg', 'message', 'error_message', 'description'] as $key) {
            if (!empty($data[$key]) && is_scalar($data[$key])) return (string)$data[$key];
        }
        if (isset($data['error'])) {
            if (is_string($data['error'])) return $data['error'];
            if (is_array($data['error'])) return $this->extractError($data['error'], $fallback);
        }
        if (isset($data['data']) && is_array($data['data'])) return $this->extractError($data['data'], $fallback);
        return $fallback;
    }
}
