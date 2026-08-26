<?php

namespace App\Services\Video\Adapters;

use App\Models\VideoProviderAccount;
use App\Models\VideoTask;
use App\Services\Video\VideoProviderInterface;
use App\Services\Video\VideoQueryResult;
use App\Services\Video\VideoSubmitResult;

/**
 * OpenAI 兼容视频协议适配器：覆盖一切提供 OpenAI 风格视频接口的服务商 / 中转 API。
 *
 * 协议特征（参考业务方调用文档）：
 *   - 创建：POST /v1/videos          body: { model, prompt, seconds, size, media_urls[] }
 *   - 查询：GET  /v1/videos/{id}     status: queued/in_progress/completed/failed/cancelled
 *   - 取消：POST /v1/videos/{id}/cancel
 *   - 模型：GET  /v1/models
 *   - 鉴权：Authorization: Bearer {key}
 *
 * 路径与尺寸可由 model_spec.provider_params 覆盖（submit_path/query_path/cancel_path/size/size_map/extra_body），
 * 模型列表路径可由 account.config.models_path 覆盖；不配置时使用上述默认值。
 */
class OpenAiVideoProvider extends AbstractVideoProvider implements VideoProviderInterface
{
    private const SUBMIT_TIMEOUT = 60;
    private const QUERY_TIMEOUT = 30;

    public function submit(VideoTask $task, VideoProviderAccount $account): VideoSubmitResult
    {
        $payload = $this->buildSubmitPayload($task);
        $result = $this->request('POST', $this->url($account, $this->submitPath($task)), $account, $payload, self::SUBMIT_TIMEOUT);

        if ($result['err'] !== '') {
            return VideoSubmitResult::fail($result['err'], 'connection_error', [], $payload);
        }
        if ($result['code'] < 200 || $result['code'] >= 300) {
            return VideoSubmitResult::fail($this->extractError($result['data'], '视频任务提交失败'), 'http_' . $result['code'], $result['data'], $payload);
        }

        $providerTaskId = $this->extractTaskId($result['data']);
        if ($providerTaskId === '') {
            if ($this->isBusinessError($result['data'])) {
                return VideoSubmitResult::fail($this->extractError($result['data'], '视频任务提交失败'), 'provider_error', $result['data'], $payload);
            }
            return VideoSubmitResult::fail('提交响应缺少任务 ID', 'missing_task_id', $result['data'], $payload);
        }

        return VideoSubmitResult::ok($providerTaskId, $this->extractStatus($result['data'], 'queued'), $result['data'], $payload);
    }

    public function query(VideoTask $task, VideoProviderAccount $account): VideoQueryResult
    {
        if (!$task->provider_task_id) {
            return VideoQueryResult::fail('任务缺少上游 provider_task_id', 'missing_provider_task_id');
        }

        $result = $this->request('GET', $this->url($account, $this->queryPath($task)), $account, [], self::QUERY_TIMEOUT);

        if ($result['err'] !== '') {
            return VideoQueryResult::fail($result['err'], 'connection_error');
        }
        if ($result['code'] < 200 || $result['code'] >= 300) {
            return VideoQueryResult::fail($this->extractError($result['data'], '视频任务查询失败'), 'http_' . $result['code'], $result['data']);
        }

        $providerStatus = $this->extractStatus($result['data'], '');
        $standardStatus = $this->normalizeStatus($providerStatus, $result['data']);

        if ($standardStatus === 'failed') {
            // 默认落 provider_failed（旧 sora/seedance 中转维持原语义，不改其落库码）。
            // 仅原生契约透传上游 error.code（content_policy_violation / material_limit_exceeded 等语义码），
            // 并隔离框架保留的瞬时码命名空间，避免上游把终态伪装成 connection_error/http_* 被误判为瞬时。
            $errorCode = 'provider_failed';
            if ($this->isNativeContract($task->modelSpec?->provider_params ?: [])) {
                $upstream = $this->extractErrorCode($result['data']);
                if ($upstream !== '' && $upstream !== 'connection_error' && $upstream !== 'missing_provider_task_id' && !str_starts_with($upstream, 'http_')) {
                    $errorCode = $upstream;
                }
            }
            return VideoQueryResult::fail($this->extractError($result['data'], '视频任务失败'), $errorCode, $result['data'], $providerStatus);
        }

        $progress = $this->extractProgress($result['data'], $standardStatus);
        $videoUrl = $this->extractVideoUrl($result['data']);
        $coverUrl = $this->extractCoverUrl($result['data']);
        $metadata = $this->extractMetadata($result['data'], $task);

        return VideoQueryResult::ok($standardStatus, $providerStatus, $progress, $videoUrl, $coverUrl, $metadata, $result['data']);
    }

    public function cancel(VideoTask $task, VideoProviderAccount $account): VideoQueryResult
    {
        $extra = $task->modelSpec?->provider_params ?: [];
        // 原生契约无 /cancel 端点，跳过必然 404 的请求；仅本地置状态。
        if ($task->provider_task_id && !$this->isNativeContract($extra)) {
            $this->request('POST', $this->url($account, $this->actionPath($task, 'cancel')), $account, [], self::QUERY_TIMEOUT);
        }
        return VideoQueryResult::ok('canceled', 'cancelled', (int) $task->progress, '', '', [], ['state' => 'cancelled']);
    }

    public function test(VideoProviderAccount $account): array
    {
        if (!$account->base_url) {
            return ['ok' => false, 'message' => '请先填写 Base URL'];
        }
        if (!$account->api_key) {
            return ['ok' => false, 'message' => '请先填写 API Key'];
        }

        $result = $this->request('GET', $this->url($account, $this->modelsPath($account)), $account, [], 15);
        if ($result['err'] !== '') {
            return ['ok' => false, 'message' => $result['err']];
        }
        if ($result['code'] === 200) {
            $count = is_array($result['data']['data'] ?? null) ? count($result['data']['data']) : 0;
            return ['ok' => true, 'message' => "连接成功，发现 {$count} 个模型"];
        }
        if (in_array($result['code'], [401, 403], true)) {
            return ['ok' => false, 'message' => '鉴权失败，请检查 API Key'];
        }
        if ($result['code'] === 404) {
            return ['ok' => false, 'message' => '模型列表地址不存在（HTTP 404），请检查 Base URL 是否含 /v1'];
        }
        return ['ok' => false, 'message' => '连接异常，HTTP ' . $result['code']];
    }

    /**
     * 拉取上游模型列表，供后台「从服务商拉取模型」使用。
     *
     * @return array<int, array{id:string, name:string}>
     */
    public function fetchModels(VideoProviderAccount $account): array
    {
        $result = $this->request('GET', $this->url($account, $this->modelsPath($account)), $account, [], 15);
        if ($result['err'] !== '') {
            throw new \RuntimeException($result['err']);
        }
        if ($result['code'] < 200 || $result['code'] >= 300) {
            throw new \RuntimeException('拉取模型失败，HTTP ' . $result['code']);
        }

        $list = $result['data']['data'] ?? $result['data']['models'] ?? [];
        $models = [];
        foreach ((array) $list as $item) {
            if (is_string($item) && $item !== '') {
                $models[] = ['id' => $item, 'name' => $item];
                continue;
            }
            if (is_array($item)) {
                $id = (string) ($item['id'] ?? $item['model'] ?? '');
                if ($id === '') {
                    continue;
                }
                $models[] = ['id' => $id, 'name' => (string) ($item['name'] ?? $id)];
            }
        }
        return $models;
    }

    private function buildSubmitPayload(VideoTask $task): array
    {
        $params = $task->request_params ?: [];
        // 交上游前把参考素材 URL 换成上游可直拉的 URL（cos/oss 私有桶预签名兜底，见基类）
        $assets = $this->materializeAssetUrls($task->input_assets ?: []);
        $extra = $task->modelSpec?->provider_params ?: [];

        $payload = [
            'model' => $task->model_id,
            'prompt' => (string) $task->prompt,
        ];

        if ($this->isNativeContract($extra)) {
            $this->fillNativeContractPayload($payload, $params, $assets);
        } else {
            $this->fillLegacyPayload($payload, $task, $params, $assets, $extra);
        }

        // 管理员逃生口：provider_params.extra_body 里的键原样并入（新旧契约通用）
        if (is_array($extra['extra_body'] ?? null)) {
            $payload = array_merge($payload, $extra['extra_body']);
        }

        return $payload;
    }

    /**
     * 是否走「原生视频契约」（cang-api ai.772.ee 新契约，见 参考/视频接入文档.md）。
     * 由 provider_params.contract=cang_native 开启；不配置则沿用旧 New API 兼容形状，
     * 对标准 sora / 其它 OpenAI 兼容中转零影响。
     *
     * 原生契约 body：model / prompt / duration(整数) / ratio / resolution(小写 720p/480p) /
     *   referenceImages[] / referenceVideos[] / referenceAudios[]；不发 size / seconds /
     *   media_urls / negative_prompt / callback_url。
     */
    private function isNativeContract(array $extra): bool
    {
        return ($extra['contract'] ?? '') === 'cang_native';
    }

    /**
     * 原生契约请求体（cang-api 新契约）。
     */
    private function fillNativeContractPayload(array &$payload, array $params, array $assets): void
    {
        // 时长：整数 duration（新契约 4-15），非旧的字符串 seconds
        $duration = (int) ($params['duration'] ?? 0);
        if ($duration > 0) {
            $payload['duration'] = $duration;
        }
        // 清晰度：小写档位 720p/480p（新契约枚举为小写，切勿 strtoupper）
        $resolution = strtolower(trim((string) ($params['resolution'] ?? '')));
        if ($resolution !== '') {
            $payload['resolution'] = $resolution;
        }
        // 画面比例：独立 ratio 字段（16:9/9:16/1:1），不再用 size 反推
        $ratio = trim((string) ($params['aspect_ratio'] ?? ''));
        if ($ratio !== '') {
            $payload['ratio'] = $ratio;
        }
        // 参考素材：按类型分离为 referenceImages / referenceVideos / referenceAudios
        $images = $this->refUrls($assets, 'image');
        if (!empty($images)) {
            $payload['referenceImages'] = $images;
        }
        $videos = $this->refUrls($assets, 'video');
        if (!empty($videos)) {
            $payload['referenceVideos'] = $videos;
        }
        $audios = $this->refUrls($assets, 'audio');
        if (!empty($audios)) {
            $payload['referenceAudios'] = $audios;
        }
    }

    /**
     * 旧 New API 兼容请求体（size + seconds + 顶层 resolution/aspect + media_urls）。
     * 保留给标准 sora / 字节 seedance 中转等未切换到原生契约的服务商。
     */
    private function fillLegacyPayload(array &$payload, VideoTask $task, array $params, array $assets, array $extra): void
    {
        $duration = (int) ($params['duration'] ?? 0);
        if ($duration > 0) {
            $payload['seconds'] = (string) $duration;
        }

        $size = $this->resolveSize($params, $extra);
        if ($size !== '') {
            $payload['size'] = $size;
        }

        // 部分 OpenAI 兼容中转（如 New API 转字节 seedance）无法从 size=宽x高 解析出上游所需的
        // 分辨率档位 / 画面比例，需显式回传。由 provider_params.resolution_param / aspect_param
        // 指定目标字段名后启用；不配置则不发送，保持对标准 sora（仅认 size）的兼容。
        // 注意：实测该中转不接受嵌套的 parameters 对象，只能用顶层标量字段。
        $resolutionField = trim((string) ($extra['resolution_param'] ?? ''));
        if ($resolutionField !== '') {
            $tier = $this->resolutionTier((string) ($params['resolution'] ?? ''));
            if ($tier !== '') {
                $payload[$resolutionField] = $tier;
            }
        }
        $aspect = trim((string) ($params['aspect_ratio'] ?? ''));
        $aspectField = trim((string) ($extra['aspect_param'] ?? ''));
        if ($aspectField !== '' && $aspect !== '') {
            $payload[$aspectField] = $aspect;
        }
        // ai.772.ee / New API 会从 size（如 854x480）gcd 推出 427:240，再因不在
        // 16:9/9:16/1:1/21:9 枚举里直接 400。有明确比例时同时带 ratio。
        if ($aspect !== '' && !isset($payload['ratio'])) {
            $payload['ratio'] = $aspect;
        }

        $mediaUrls = $this->mediaUrls($assets);
        if (!empty($mediaUrls)) {
            $payload['media_urls'] = $mediaUrls;
        }

        if ((string) $task->negative_prompt !== '') {
            $payload['negative_prompt'] = (string) $task->negative_prompt;
        }
        if (!empty($params['callback_url'])) {
            $payload['callback_url'] = $params['callback_url'];
        }
    }

    /**
     * 按资产类型取参考素材 URL（原生契约的 referenceImages/Videos/Audios 用）。
     * 优先用带 index 的 assets 明细并按 index 排序；缺失时回退 images/videos/audios 数组。
     *
     * @return array<int, string>
     */
    private function refUrls(array $assets, string $type): array
    {
        $out = [];
        $items = is_array($assets['assets'] ?? null) ? $assets['assets'] : [];
        if (!empty($items)) {
            usort($items, fn($a, $b) => ((int) ($a['index'] ?? 0)) <=> ((int) ($b['index'] ?? 0)));
            foreach ($items as $asset) {
                if (is_array($asset) && ($asset['asset_type'] ?? '') === $type) {
                    $url = (string) ($asset['url'] ?? '');
                    if ($url !== '') {
                        $out[] = $url;
                    }
                }
            }
            if (!empty($out)) {
                return $out;
            }
        }
        $key = ['image' => 'images', 'video' => 'videos', 'audio' => 'audios'][$type] ?? '';
        foreach ((array) ($assets[$key] ?? []) as $url) {
            if (is_string($url) && $url !== '') {
                $out[] = $url;
            }
        }
        return $out;
    }

    private function mediaUrls(array $assets): array
    {
        $items = is_array($assets['assets'] ?? null) ? $assets['assets'] : [];
        if (!empty($items)) {
            usort($items, fn($a, $b) => ((int) ($a['index'] ?? 0)) <=> ((int) ($b['index'] ?? 0)));
            $urls = [];
            foreach ($items as $asset) {
                if (!is_array($asset)) {
                    continue;
                }
                if (!in_array($asset['asset_type'] ?? '', ['image', 'video'], true)) {
                    continue;
                }
                $url = (string) ($asset['url'] ?? '');
                if ($url !== '') {
                    $urls[] = $url;
                }
            }
            if (!empty($urls)) {
                return $urls;
            }
        }

        $urls = [];
        foreach (['images', 'videos'] as $key) {
            foreach ((array) ($assets[$key] ?? []) as $url) {
                if (is_string($url) && $url !== '') {
                    $urls[] = $url;
                }
            }
        }
        return $urls;
    }

    private function resolveSize(array $params, array $extra): string
    {
        if (!empty($extra['size']) && is_string($extra['size'])) {
            return $extra['size'];
        }
        $resolution = (string) ($params['resolution'] ?? '');
        $aspect = (string) ($params['aspect_ratio'] ?? '');
        $map = $extra['size_map'] ?? null;
        if (is_array($map) && isset($map[$resolution][$aspect]) && is_string($map[$resolution][$aspect])) {
            return $map[$resolution][$aspect];
        }
        return $this->builtinSize($resolution, $aspect);
    }

    private function builtinSize(string $resolution, string $aspect): string
    {
        $table = [
            '480p' => ['16:9' => '854x480', '9:16' => '480x854', '1:1' => '480x480', '4:3' => '640x480', '3:4' => '480x640'],
            '720p' => ['16:9' => '1280x720', '9:16' => '720x1280', '1:1' => '720x720', '4:3' => '960x720', '3:4' => '720x960'],
            '1080p' => ['16:9' => '1920x1080', '9:16' => '1080x1920', '1:1' => '1080x1080', '4:3' => '1440x1080', '3:4' => '1080x1440'],
            '4k' => ['16:9' => '3840x2160', '9:16' => '2160x3840', '1:1' => '2160x2160'],
        ];
        return $table[$resolution][$aspect] ?? '';
    }

    /**
     * 分辨率档位归一化为大写形式：720p → 720P、1080p → 1080P、4k → 4K。
     * 系统内部统一存小写标准值，部分上游（字节 seedance）要求大写枚举。
     */
    private function resolutionTier(string $resolution): string
    {
        return strtoupper(trim($resolution));
    }

    private function submitPath(VideoTask $task): string
    {
        $params = $task->modelSpec?->provider_params ?: [];
        return ((string) ($params['submit_path'] ?? '')) ?: '/v1/videos';
    }

    private function queryPath(VideoTask $task): string
    {
        $params = $task->modelSpec?->provider_params ?: [];
        $tpl = ((string) ($params['query_path'] ?? '')) ?: '/v1/videos/{task_id}';
        return str_replace('{task_id}', rawurlencode((string) $task->provider_task_id), $tpl);
    }

    private function actionPath(VideoTask $task, string $action): string
    {
        $params = $task->modelSpec?->provider_params ?: [];
        $tpl = ((string) ($params[$action . '_path'] ?? '')) ?: ('/v1/videos/{task_id}/' . $action);
        return str_replace('{task_id}', rawurlencode((string) $task->provider_task_id), $tpl);
    }

    private function modelsPath(VideoProviderAccount $account): string
    {
        $config = is_array($account->config) ? $account->config : [];
        return ((string) ($config['models_path'] ?? '')) ?: '/v1/models';
    }

    private function extractTaskId(array $data): string
    {
        foreach (['id', 'task_id'] as $key) {
            if (!empty($data[$key]) && is_scalar($data[$key])) {
                return (string) $data[$key];
            }
        }
        if (isset($data['data']) && is_array($data['data'])) {
            return $this->extractTaskId($data['data']);
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
        if (isset($data['data']) && is_array($data['data'])) {
            $status = $this->extractStatus($data['data'], '');
            if ($status !== '') {
                return $status;
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
        foreach (['progress', 'percent'] as $key) {
            if (isset($data[$key]) && is_numeric($data[$key])) {
                return max(0, min(99, (int) round((float) $data[$key])));
            }
        }
        if (isset($data['data']) && is_array($data['data'])) {
            foreach (['progress', 'percent'] as $key) {
                if (isset($data['data'][$key]) && is_numeric($data['data'][$key])) {
                    return max(0, min(99, (int) round((float) $data['data'][$key])));
                }
            }
        }
        return $status === 'pending' ? 5 : 50;
    }

    private function extractVideoUrl(array $data): string
    {
        foreach (['video_url', 'url', 'output_url', 'download_url'] as $key) {
            if (!empty($data[$key]) && is_string($data[$key]) && preg_match('#^https?://#i', $data[$key])) {
                return $data[$key];
            }
        }
        foreach (['result', 'output'] as $key) {
            if (isset($data[$key]) && is_array($data[$key])) {
                $url = $this->extractVideoUrl($data[$key]);
                if ($url !== '') {
                    return $url;
                }
            }
        }
        if (isset($data['data']) && is_array($data['data'])) {
            $direct = $this->extractVideoUrl($data['data']);
            if ($direct !== '') {
                return $direct;
            }
            foreach ($data['data'] as $item) {
                if (is_array($item)) {
                    $url = $this->extractVideoUrl($item);
                    if ($url !== '') {
                        return $url;
                    }
                }
            }
        }
        return '';
    }

    private function extractCoverUrl(array $data): string
    {
        foreach (['thumbnail_url', 'cover_url', 'poster_url'] as $key) {
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
        $node = is_array($data['metadata'] ?? null) ? $data['metadata'] : $data;
        return [
            'duration_seconds' => (int) ($node['duration'] ?? $node['seconds'] ?? $task->request_params['duration'] ?? 0),
            'width' => (int) ($node['width'] ?? 0),
            'height' => (int) ($node['height'] ?? 0),
            'mime_type' => 'video/mp4',
            'raw_keys' => array_keys($data),
        ];
    }

    private function extractError(array $data, string $fallback): string
    {
        if (isset($data['error'])) {
            if (is_string($data['error']) && $data['error'] !== '') {
                return $data['error'];
            }
            if (is_array($data['error'])) {
                foreach (['message', 'reason'] as $key) {
                    if (!empty($data['error'][$key]) && is_scalar($data['error'][$key])) {
                        return (string) $data['error'][$key];
                    }
                }
            }
        }
        foreach (['msg', 'message', 'error_message', 'detail'] as $key) {
            if (!empty($data[$key]) && is_scalar($data[$key])) {
                return (string) $data[$key];
            }
        }
        if (isset($data['data']) && is_array($data['data'])) {
            $msg = $this->extractError($data['data'], '');
            if ($msg !== '') {
                return $msg;
            }
        }
        return $fallback;
    }

    /**
     * 提取上游标准错误码（新契约 error.code：unsupported_material / content_policy_violation /
     * material_limit_exceeded / generation_timeout / server_error 等）。缺失返回空串。
     */
    private function extractErrorCode(array $data): string
    {
        if (isset($data['error']) && is_array($data['error'])) {
            $code = $data['error']['code'] ?? '';
            if (is_scalar($code) && (string) $code !== '') {
                return (string) $code;
            }
        }
        // 顶层 code 仅当为字符串枚举时采纳，避免把 HTTP/数字状态码误当业务码
        foreach (['error_code', 'code'] as $key) {
            if (isset($data[$key]) && is_string($data[$key]) && $data[$key] !== '') {
                return $data[$key];
            }
        }
        if (isset($data['data']) && is_array($data['data'])) {
            return $this->extractErrorCode($data['data']);
        }
        return '';
    }
}
