<?php

namespace App\Services\Gateway\Adapters;

use App\Models\CloudProvider;
use App\Services\Gateway\Contracts\ProbeResult;
use App\Services\Gateway\Contracts\UpstreamResponse;
use App\Services\StorageService;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

/**
 * 多米 API 适配器（duomiapi.com）— 官方文档 https://duomiapi.com/doc/55
 *
 * 多米是一个聚合多家 AIGC 服务的中转平台。本适配器**仅覆盖** OPENAI 系列下的图片生成：
 * 当前官方支持的模型仅 1 个 —— gpt-image-2（异步路径）。其它能力（chat / embeddings）
 * 多米图像产品不提供，调用时统一返回 not_supported。
 *
 * 与 OpenAI 兼容协议的实质差异（按官方 apifox schema 一一对应）：
 *   1. 鉴权头：Authorization: <api_key>，**裸 token、不带 Bearer 前缀**
 *   2. 图片生成只支持异步：
 *      - 提交：POST /v1/images/generations?async=true → { id }              (api-192667743)
 *      - 轮询：GET  /v1/tasks/{id}                    → { state, data, ... } (api-447345474)
 *   3. 请求 body 仅 4 个字段：model / prompt / size / image — 其他字段一律丢弃
 *   4. 没有 /v1/models / /v1/chat/completions / /v1/embeddings 端点
 *
 * 本适配器把异步细节封装在 image() 内（提交→轮询→翻译为 OpenAI 形态），上层
 * （ProcessImageTaskJob / NewGatewayService）拿到的是与 OpenAICompatibleAdapter 字段
 * 完全一致的 { created, data:[{url}], usage } 结构，无需感知异步差异。
 */
class DuoMiAdapter extends OpenAICompatibleAdapter
{
    /** 单次 GET /v1/tasks/{id} 轮询请求超时（秒）。 */
    private const POLL_REQUEST_TIMEOUT = 15;

    /** 两次轮询之间的等待间隔（秒）。 */
    private const POLL_INTERVAL = 3;

    /** 提交任务的请求超时（秒）。仅 POST 创建，几乎瞬时返回 task id。 */
    private const SUBMIT_TIMEOUT = 30;


    /**
     * 图片生成（多米只有 generations 异步端点）。
     *
     * 客户端传 endpoint=edits（OpenAI 协议「有参考图」分支）时，由本方法内部统一映射为
     * generations，body.images（OpenAI 复数 base64 数组）→ body.image（多米单数字段，
     * 取值为 string[]），对桌面端透明。参考图 normalize / dataUri 补齐由 cleanseDuoMiBody。
     *
     * 1.3.10 起：**底层 HTTP 客户端从 Laravel Http (Guzzle) 改为原生 PHP curl**，与多米官方 PHP
     * 示例（https://duomiapi.com/v1/images/generations?async=true）1:1 对齐。该改动是「升级到
     * 1.3.9 后 size=2048x2048 仍触发 HTML 400」的最终修复——综合根因有三：
     *
     *   1. Laravel `PendingRequest::withHeaders` 用 `array_merge_recursive`（不是 array_merge）
     *      合并 headers。`parent::buildHttp` 调 `withToken($apiKey)` 后 headers['Authorization']
     *      = 'Bearer xxx'；再 `withHeaders(['Authorization' => $apiKey])` 是预期「裸 token 覆盖
     *      Bearer」，**实际累加成 `['Bearer xxx', 'xxx']` 数组** → Guzzle 发送两个 Authorization
     *      头 → 多米 nginx 网关层认定异常请求 → HTML 400。
     *   2. Guzzle 默认 User-Agent 为 `GuzzleHttp/<version>`，多米上游 WAF 对该 UA 拦截较严；
     *      原生 PHP curl 不显式发送 User-Agent 头，与桌面端 Node fetch 行为一致（实测可通过）。
     *   3. multi-米 size enum 仅接受 3 个固定像素串 + 11 个比例 + auto，桌面端按 UI 档位算出的
     *      "2048x2048" / "3840x2160" 在 enum 之外，触发 nginx 参数校验失败。
     *
     * 修复策略：
     *   1. body 用严格白名单 + size 反向 snap 到 enum 合法比例（cleanseDuoMiBody）
     *   2. submit / poll 全部走原生 curl（submitViaCurl / pollViaCurl），与官方示例 100% 对齐
     *   3. 不再继承父类 buildHttp，从根上避开 Authorization 累加 bug
     *
     * 流程：
     *   1. POST /v1/images/generations?async=true → { id }
     *   2. 轮询 GET /v1/tasks/{id} 直到 state=succeeded/failed 或总耗时超过 image timeout
     *   3. succeeded → 翻译为 OpenAI 形态 { created, data:[{url}, ...] }
     */
    public function image(string $endpoint, array $body, CloudProvider $provider, string $apiKey): UpstreamResponse
    {
        // 多米只有 generations 端点（异步）。桌面端 cloud 路径在「有参考图」时会把 endpoint 切到 edits + body.images=base64[]，
        // 在这里统一映射为 generations + body.image，对桌面端透明（避免桌面端按服务商分支处理）。
        if ($endpoint !== 'generations' && $endpoint !== 'edits') {
            return UpstreamResponse::fail(
                400,
                null,
                "多米 API 不支持 images/{$endpoint} 端点（仅支持 generations / edits，二者内部都走 generations 异步）"
            );
        }

        // 多米官方 schema 没有 mask 字段；上游 nginx WAF 对未声明字段拦截较严。
        // 若客户端传了 mask（蒙版编辑），明确拒绝，避免「成功出图但 mask 被忽略」的隐性失败。
        if (!empty($body['mask'])) {
            return UpstreamResponse::fail(
                400,
                null,
                '多米 API 不支持蒙版（mask）编辑'
            );
        }

        // OpenAI 协议复数 `images`（桌面端 cloud 路径用，元素为 strip 后的纯 base64 字符串）
        // → 多米原生 `image` 字段（schema: type=string，描述允许「单张 string 或多张 string[]」）
        // 实际取值的 dataUri 补齐由 cleanseDuoMiBody → normalizeImages 统一处理。
        if (!empty($body['images']) && is_array($body['images']) && empty($body['image'])) {
            $body['image'] = $body['images'];
        }
        unset($body['images']);

        $submitBody = $this->cleanseDuoMiBody($body);

        // 多米上游只可靠接受图片 URL：data:image/...;base64,... 与裸 base64 会被 nginx WAF
        // 拒收（fail_to_submit_task）或静默忽略参考图。这里把参考图先落对象存储换成公网 http
        // URL，任务结束后（finally）删除这些临时文件 —— image() 全程同步阻塞到出图，URL
        // 用完即删，不产生孤儿堆积。$uploadedRefUrls 由 materialize 以引用逐张累积，即使其
        // 中途异常 finally 也能清掉已传部分；仅 worker 超时被强杀才会漏，靠 COS 生命周期兜底。
        $uploadedRefUrls = [];
        try {
            if (!empty($submitBody['image'])) {
                $submitBody['image'] = $this->materializeReferenceImages((array) $submitBody['image'], $uploadedRefUrls);
            }
            return $this->submitAndPoll($submitBody, $provider, $apiKey);
        } finally {
            foreach ($uploadedRefUrls as $refUrl) {
                try {
                    StorageService::delete($refUrl);
                } catch (Throwable $e) {
                    Log::warning('[adapter.duomi.ref] 临时参考图清理失败 url=' . $refUrl . ': ' . $e->getMessage());
                }
            }
        }
    }

    /**
     * 提交多米异步任务并轮询到终态，翻译为 OpenAI 形态。从 image() 抽出，
     * 让 image() 专注「参考图换 URL + 用完即删」的生命周期管理。
     */
    private function submitAndPoll(array $submitBody, CloudProvider $provider, string $apiKey): UpstreamResponse
    {
        // 1) 提交任务（用原生 curl，与官方 PHP 示例 1:1）
        //    内联 1 次重试：多米 submit 偶发 502 是已知现象（与桌面端 fetchWithRetry 行为对齐）。
        //    触发条件：curl 错误 / HTTP 429 / 500-504 / 524。500ms 退避，最多 2 次尝试。
        $submitUrl = $this->buildUrl($provider, 'images/generations');
        $submitUrl .= (str_contains($submitUrl, '?') ? '&' : '?') . 'async=true';

        $submitResult = $this->submitWithRetry($submitUrl, $apiKey, $submitBody);

        if ($submitResult['err'] !== '') {
            return UpstreamResponse::fail(0, null, $this->classifyConnectionError($submitResult['err']));
        }

        $submitCode = $submitResult['code'];
        $submitRawBody = $submitResult['body'];
        $submitData = $this->safeJsonDecode($submitRawBody);

        if ($submitCode < 200 || $submitCode >= 300) {
            return UpstreamResponse::fail(
                $submitCode,
                is_array($submitData) ? $submitData : null,
                '多米 API 提交任务失败 (HTTP ' . $submitCode . ')' . $this->summarizeErrorBody($submitRawBody)
            );
        }

        $taskId = is_array($submitData) ? (string) ($submitData['id'] ?? '') : '';
        if ($taskId === '') {
            return UpstreamResponse::fail(
                502,
                is_array($submitData) ? $submitData : null,
                '多米 API 响应缺少 task id 字段（协议不规范）' . $this->summarizeErrorBody($submitRawBody)
            );
        }

        // 2) 轮询任务结果。总等待上限沿用 gateway.timeouts.image（默认 900s/15min，与 OpenAI 同步图片同档）
        $totalDeadlineSec = (int) config('gateway.timeouts.image', 900);
        $deadline = microtime(true) + $totalDeadlineSec;
        $statusUrl = $this->buildUrl($provider, 'tasks/' . $taskId);

        $lastState = null;
        $lastStatusBody = null;

        while (microtime(true) < $deadline) {
            // 先 sleep 再查（提交后立刻查通常是 pending，浪费一次往返）
            sleep(self::POLL_INTERVAL);

            $pollResult = $this->pollViaCurl($statusUrl, $apiKey, self::POLL_REQUEST_TIMEOUT);

            if ($pollResult['err'] !== '') {
                // 单次轮询异常不立即结束，继续等到 deadline
                Log::info("[adapter.duomi.image.poll] task={$taskId} transient err=" . $pollResult['err']);
                continue;
            }

            $statusCode = $pollResult['code'];
            $statusData = $this->safeJsonDecode($pollResult['body']);
            $lastStatusBody = $statusData;

            if ($statusCode === 401) {
                return UpstreamResponse::fail(401, is_array($statusData) ? $statusData : null, '多米 API 鉴权失败（HTTP 401）：API Key 无效或已过期');
            }
            if ($statusCode < 200 || $statusCode >= 300) {
                // 4xx/5xx 中间态：继续轮询直到超时（多米偶发 502 是常见现象）
                continue;
            }

            $state = is_array($statusData) ? (string) ($statusData['state'] ?? '') : '';
            $lastState = $state;

            if ($state === 'succeeded') {
                $images = [];
                if (is_array($statusData) && isset($statusData['data']['images']) && is_array($statusData['data']['images'])) {
                    foreach ($statusData['data']['images'] as $img) {
                        if (is_array($img) && !empty($img['url'])) {
                            $images[] = ['url' => (string) $img['url']];
                        }
                    }
                }
                if (empty($images)) {
                    return UpstreamResponse::fail(
                        502,
                        is_array($statusData) ? $statusData : null,
                        '多米 API 任务声明成功但未返回图片 URL（task_id=' . $taskId . '）'
                    );
                }
                return UpstreamResponse::ok(200, [
                    'created' => (int) ($statusData['create_time'] ?? time()),
                    'data'    => $images,
                ], []);
            }

            if ($state === 'failed' || $state === 'error' || $state === 'cancelled') {
                $msg = is_array($statusData) ? (string) ($statusData['data']['description'] ?? $statusData['message'] ?? '任务执行失败') : '任务执行失败';
                return UpstreamResponse::fail(
                    502,
                    is_array($statusData) ? $statusData : null,
                    "多米 API 任务失败（state={$state}, task_id={$taskId}）：{$msg}"
                );
            }
            // 其它取值（pending / running / processing / queued / ...）→ 继续轮询
        }

        return UpstreamResponse::fail(
            504,
            is_array($lastStatusBody) ? $lastStatusBody : null,
            "多米 API 任务超时（>{$totalDeadlineSec}s 未完成，task_id={$taskId}，last_state=" . ($lastState ?: 'unknown') . '）'
        );
    }

    /**
     * body 严格白名单清洗 — 按多米官方文档 https://duomiapi.com/doc/55 + apifox schema 对齐。
     *
     * 官方文档列出的字段仅 4 个：
     *   - model   string  固定 'gpt-image-2'（其他模型多米未支持）
     *   - prompt  string  ≤5000 字（按 apifox 历史 schema 上限）
     *   - size    string  比例（"16:9" / "1:1" 等）或 enum 像素串（1024x1024 / 1024x1792 / 1792x1024）
     *   - image   string|string[]  参考图：URL / dataUri / 纯 base64 三态由 normalizeImages 归一
     *
     * **其他字段一律丢弃**（quality / seed / response_format / n / style / user / cloud_model_id 等）。
     * 多米 nginx WAF 对未声明字段拦截较严，OpenAI 协议遗留字段会触发 HTML 400 fail_to_submit_task。
     */
    private function cleanseDuoMiBody(array $body): array
    {
        $out = [];

        // model: 官方仅列 gpt-image-2。用户 cloud_models.model_id 与之不符时强制改写并打 info 日志，
        // 避免上游 400；UI 层（Models.tsx / ModelView.vue）已锁定，此处是服务端兜底兼容历史不规范数据。
        $rawModel = is_string($body['model'] ?? null) ? trim((string) $body['model']) : '';
        if ($rawModel !== '' && $rawModel !== 'gpt-image-2') {
            Log::info("[adapter.duomi.cleanse] override model '{$rawModel}' → 'gpt-image-2' (多米官方仅 gpt-image-2)");
        }
        $out['model'] = 'gpt-image-2';

        // prompt: 官方文档未列长度上限；按 apifox 历史 schema 取 5000 截断。
        if (isset($body['prompt']) && is_string($body['prompt']) && $body['prompt'] !== '') {
            $out['prompt'] = mb_substr($body['prompt'], 0, 5000);
        }

        // size: v0.6.6+ 多米实测支持标准 gpt-image-2 规则的真实像素串（如 '3840x2160'）、
        // 比例字符串与 'auto'。cleanseDuoMiSize 仅做格式校验，不再反向 snap，让桌面端 2K/4K 档位生效。
        $rawSize = is_string($body['size'] ?? null) ? $body['size'] : '';
        $out['size'] = $this->cleanseDuoMiSize($rawSize);

        // image: 官方示例为 URL 数组；实测 dataUri 数组亦可。normalizeImages 兼容 URL/dataUri/纯 base64。
        $images = $this->normalizeImages($body['image'] ?? null);
        if (!empty($images)) {
            $out['image'] = $images;
        }

        return $out;
    }

    /**
     * 把任意 image 输入归一化为多米可接受的 dataUri 数组。
     *
     * 输入形态：
     *   - 单 string（多米 schema 允许，但桌面端走数组路径更通用）
     *   - 数组：元素可能是 https URL / dataUri / 纯 base64
     *
     * 元素处理：
     *   - https?:// URL → 直通（文档示例标准用法）
     *   - data:image/...;base64,... → 直通（2026-05-13 实测 succeeded）
     *   - 纯 base64（桌面端 cloud 路径 stripBase64 后送来的形态）→ 补 data:image/png;base64, 前缀
     *   - 空 / 非 string → 跳过
     */
    private function normalizeImages($input): array
    {
        if (is_string($input)) {
            $input = [$input];
        }
        if (!is_array($input)) {
            return [];
        }
        $out = [];
        foreach ($input as $item) {
            if (!is_string($item) || $item === '') continue;
            if (preg_match('#^https?://#i', $item)) {
                $out[] = $item;
                continue;
            }
            if (preg_match('#^data:image/[\w+.-]+;base64,#i', $item)) {
                $out[] = $item;
                continue;
            }
            // 纯 base64：补默认 png dataUri 前缀（PNG 与 JPEG 容器无关，多米按 base64 实际字节解码）
            $out[] = 'data:image/png;base64,' . $item;
        }
        return $out;
    }

    /**
     * 把参考图数组里的 dataUri / 纯 base64 元素上传到对象存储，替换为公网 http URL。
     *
     * 多米上游只可靠接受图片 URL：data:image/...;base64,... 与裸 base64 会被 nginx WAF
     * 拒收或静默忽略参考图。已是 http(s) URL 的元素原样直通（不重复上传、不纳入清理）。
     *
     * @param string[] $images   normalizeImages 产出的数组（http URL 或 data:image/...;base64,...）
     * @param string[] $uploaded 引用：逐张累积本次新上传的临时 URL（供调用方 finally 清理；
     *                          即使本方法中途异常也已记录已传部分，不留无主孤儿）
     * @return string[] 给多米的最终 URL 数组
     */
    private function materializeReferenceImages(array $images, array &$uploaded): array
    {
        $finalUrls = [];

        foreach ($images as $item) {
            if (!is_string($item) || $item === '') {
                continue;
            }
            // 已是公网 URL：直通
            if (preg_match('#^https?://#i', $item)) {
                $finalUrls[] = $item;
                continue;
            }

            // 解析 dataUri / 纯 base64 → mime + 原始字节
            if (preg_match('#^data:([\w/+.-]+);base64,(.*)$#is', $item, $m)) {
                $mime = strtolower(trim($m[1]));
                $raw = base64_decode($m[2], true);
            } else {
                $mime = 'image/png';
                $raw = base64_decode($item, true);
            }
            if ($raw === false || $raw === '') {
                Log::warning('[adapter.duomi.ref] 跳过无法解码的 base64 参考图');
                continue;
            }

            // 真实类型以字节 magic 为准：normalizeImages 对纯 base64 一律补 image/png，与实际
            // 字节（cloud 路径常为 jpeg）不符会让 COS 对象 Content-Type 失真，部分下游按
            // Content-Type 处理可能出错。按 magic bytes 重嗅探，保证类型/扩展名与内容一致。
            $mime = $this->sniffImageMime($raw, $mime);
            $filename = Str::uuid()->toString() . '.' . $this->mimeToExt($mime);
            $url = StorageService::putBytes($raw, $mime, 'duomi-image-ref/' . date('Ymd'), $filename);
            if ($url === null) {
                // 上传失败：回退原 dataUri（多米大概率仍拒，但不静默丢参考图，便于排错）
                Log::warning('[adapter.duomi.ref] 参考图上传对象存储失败，回退 dataUri');
                $finalUrls[] = $item;
                continue;
            }
            // local 存储返回相对路径，补成绝对 URL（多米上游需公网可达；生产应配 cos）
            if (!preg_match('#^https?://#i', $url)) {
                $url = rtrim((string) config('app.url'), '/') . $url;
            }

            $finalUrls[] = $url;
            $uploaded[] = $url;
        }

        return $finalUrls;
    }

    /**
     * 图片 MIME → 文件扩展名（仅覆盖常见图片类型，未知兜底 png）。
     */
    private function mimeToExt(string $mime): string
    {
        return match (strtolower(trim($mime))) {
            'image/jpeg', 'image/jpg' => 'jpg',
            'image/webp' => 'webp',
            'image/gif' => 'gif',
            'image/bmp' => 'bmp',
            default => 'png',
        };
    }

    /**
     * 按文件头 magic bytes 嗅探图片真实 MIME，识别不出时返回 fallback。
     */
    private function sniffImageMime(string $bytes, string $fallback): string
    {
        $len = strlen($bytes);
        if ($len >= 3 && substr($bytes, 0, 3) === "\xFF\xD8\xFF") {
            return 'image/jpeg';
        }
        if ($len >= 8 && substr($bytes, 0, 8) === "\x89PNG\r\n\x1a\n") {
            return 'image/png';
        }
        if ($len >= 6 && (substr($bytes, 0, 6) === 'GIF87a' || substr($bytes, 0, 6) === 'GIF89a')) {
            return 'image/gif';
        }
        if ($len >= 12 && substr($bytes, 0, 4) === 'RIFF' && substr($bytes, 8, 4) === 'WEBP') {
            return 'image/webp';
        }
        if ($len >= 2 && substr($bytes, 0, 2) === 'BM') {
            return 'image/bmp';
        }
        return $fallback;
    }

    /**
     * size 字段轻量校验：透传有效的像素串和比例字符串、兑底 'auto'。
     *
     * v0.6.6+ 多米实测支持标准 gpt-image-2 规则的任意 WxH 像素串（最大 3840×2160 = 8.29M 像素），
     * 原先反向 snap 到比例 enum 会丢掉桌面端用户选的 2K/4K 档位，现在改为透传让档位生效。
     *
     * 顺序：
     *   1. 'auto' / 空串 → 'auto'
     *   2. WxH 像素串（含 ×）→ 标准化大小写后透传
     *   3. W:H 比例字符串（含中文冒号）→ 透传
     *   4. 其他都不匹配 → 'auto' 兑底（让多米按默认尺寸渲染，不替用户做决定）
     */
    private function cleanseDuoMiSize(string $size): string
    {
        $s = strtolower(trim($size));
        if ($s === '' || $s === 'auto') {
            return 'auto';
        }
        if (preg_match('/^(\d+)\s*[xX×]\s*(\d+)$/u', $s, $m)) {
            return ((int) $m[1]) . 'x' . ((int) $m[2]);
        }
        if (preg_match('/^(\d+)\s*[:：]\s*(\d+)$/u', $s, $m)) {
            return ((int) $m[1]) . ':' . ((int) $m[2]);
        }
        return 'auto';
    }

    /**
     * POST 提交任务（原生 curl，与多米官方 PHP 示例 1:1 对齐）。
     *
     * 不使用 Laravel Http / Guzzle 的原因：
     *   1. Laravel withHeaders 用 array_merge_recursive，先 withToken('Bearer x') 再 withHeaders
     *      覆盖 Authorization 会把头累加成数组、最终发出两个 Authorization 头被 multi-米 nginx 拒
     *   2. Guzzle 默认 User-Agent=GuzzleHttp/x 被多米上游 WAF 拦截
     *   3. Guzzle 走 HTTP/2 协商可能与多米 nginx 1.1-only 配置不兼容
     *
     * curl 默认行为：
     *   - 不发送 User-Agent 头（除非显式 CURLOPT_USERAGENT）
     *   - Authorization 只显式设一次（无累加 bug）
     *   - 强制 HTTP/1.1
     *   - 仅 2 个 header：Authorization + Content-Type
     */
    /**
     * 多米 submit 内联重试包装器：
     *   - curl 层错误（DNS / refused / timeout）→ 视为瞬态，重试 1 次
     *   - HTTP 429 / 500-504 / 524 → 视为瞬态，重试 1 次
     *   - HTTP 2xx → 直接返回成功
     *   - HTTP 其他 4xx / 5xx → 视为终态（鉴权 / 余额 / 违规），直接返回不重试
     *   退避：500ms（多米 submit 实际几乎瞬时，过长退避意义不大）。
     */
    private function submitWithRetry(string $url, string $apiKey, array $body): array
    {
        $maxAttempts = 2;
        $lastResult = ['err' => 'submit not attempted', 'code' => 0, 'body' => ''];

        for ($attempt = 0; $attempt < $maxAttempts; $attempt++) {
            $result = $this->submitViaCurl($url, $apiKey, $body, self::SUBMIT_TIMEOUT);

            // 成功：HTTP 2xx 直接返回
            if ($result['err'] === '' && $result['code'] >= 200 && $result['code'] < 300) {
                return $result;
            }

            $lastResult = $result;

            // 是否值得重试：curl 错误 OR (429 / 500-504 / 524)
            $isTransient = $result['err'] !== ''
                || $result['code'] === 429
                || $result['code'] === 524
                || ($result['code'] >= 500 && $result['code'] <= 504);

            if (!$isTransient || $attempt >= $maxAttempts - 1) {
                return $result;
            }

            $reason = $result['err'] !== '' ? ('curl_err=' . $result['err']) : ('HTTP ' . $result['code']);
            Log::info("[adapter.duomi.submit] retry attempt=" . ($attempt + 1) . " {$reason}");
            usleep(500_000); // 500ms
        }

        return $lastResult;
    }

    private function submitViaCurl(string $url, string $apiKey, array $body, int $timeoutSeconds): array
    {
        $bodyJson = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($bodyJson === false) {
            return ['body' => '', 'code' => 0, 'err' => 'body json_encode failed'];
        }

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_ENCODING       => '',
            CURLOPT_MAXREDIRS      => 10,
            CURLOPT_TIMEOUT        => $timeoutSeconds,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_HTTP_VERSION   => CURL_HTTP_VERSION_1_1,
            CURLOPT_CUSTOMREQUEST  => 'POST',
            CURLOPT_POSTFIELDS     => $bodyJson,
            CURLOPT_HTTPHEADER     => [
                'Authorization: ' . $apiKey,
                'Content-Type: application/json',
            ],
        ]);

        $resp = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = $resp === false ? curl_error($ch) : '';
        curl_close($ch);

        return [
            'body' => is_string($resp) ? $resp : '',
            'code' => $code,
            'err'  => $err,
        ];
    }

    /**
     * GET 轮询任务状态（原生 curl）。仅 1 个 Authorization 头，无 Content-Type。
     */
    private function pollViaCurl(string $url, string $apiKey, int $timeoutSeconds): array
    {
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_ENCODING       => '',
            CURLOPT_MAXREDIRS      => 10,
            CURLOPT_TIMEOUT        => $timeoutSeconds,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_HTTP_VERSION   => CURL_HTTP_VERSION_1_1,
            CURLOPT_CUSTOMREQUEST  => 'GET',
            CURLOPT_HTTPHEADER     => [
                'Authorization: ' . $apiKey,
            ],
        ]);

        $resp = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = $resp === false ? curl_error($ch) : '';
        curl_close($ch);

        return [
            'body' => is_string($resp) ? $resp : '',
            'code' => $code,
            'err'  => $err,
        ];
    }

    /**
     * 安全的 JSON 解码：失败时返回 null（不抛错）。
     */
    private function safeJsonDecode(string $raw): ?array
    {
        if ($raw === '') return null;
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : null;
    }

    /**
     * 多米 API 不提供 chat completions，直接报错（避免上层误以为兼容 OpenAI chat）。
     */
    public function chat(array $body, CloudProvider $provider, string $apiKey): UpstreamResponse
    {
        return UpstreamResponse::fail(400, null, '多米 API 不支持 chat completions（仅图片生成 gpt-image-2）');
    }

    /**
     * 多米 API 不提供流式 chat。返回 0 让上层不计费、不写入流式响应。
     */
    public function chatStream(
        array $body,
        CloudProvider $provider,
        string $apiKey,
        callable $onChunk,
        callable $onUsage
    ): int {
        $onChunk("data: {\"error\":{\"message\":\"多米 API 不支持 chat completions\",\"type\":\"not_supported\"}}\n\n");
        $onChunk("data: [DONE]\n\n");
        return 400;
    }

    /**
     * 多米 API 不提供 embeddings。
     */
    public function embeddings(array $body, CloudProvider $provider, string $apiKey): UpstreamResponse
    {
        return UpstreamResponse::fail(400, null, '多米 API 不支持 embeddings（仅图片生成 gpt-image-2）');
    }

    /**
     * 探测：多米没有 /v1/models 端点。改为对一个 dummy task id 做 GET /v1/tasks/{id}：
     *   - 401            → 鉴权失败（可识别 API Key 是否有效）
     *   - 404 / 200 / 400 → 连接 + 鉴权 OK（task 不存在很正常），返回内置已知模型清单
     *   - 5xx            → 上游异常
     *
     * 内置模型清单：gpt-image-2（按官方文档 https://duomiapi.com/doc/55 当前唯一支持）。
     */
    public function probeModels(CloudProvider $provider, string $apiKey, int $timeoutSeconds = 15): ProbeResult
    {
        if (empty($provider->api_base)) {
            return ProbeResult::error('请先填写 API 地址', null, '');
        }
        if (empty($apiKey)) {
            return ProbeResult::error('请先填写 API 密钥', null, '');
        }

        // 用极短 dummy taskId 探测 /v1/tasks/{id}：与真实路径保持一致以验证鉴权与基础路由
        // 走 pollViaCurl 与 image() 的轮询路径完全一致，避免 Laravel Http 的 Authorization 累加
        // bug 造成「实际能用但 probe 失败」或「probe 通过但实际调用 401」这类不一致现象。
        $probeUrl = $this->buildUrl($provider, 'tasks/__probe__');

        try {
            $pollResult = $this->pollViaCurl($probeUrl, $apiKey, $timeoutSeconds);

            if ($pollResult['err'] !== '') {
                return ProbeResult::error('无法连接：' . $this->classifyConnectionError($pollResult['err']), null, $probeUrl);
            }

            $code = $pollResult['code'];

            if ($code === 401) {
                return ProbeResult::error('鉴权失败（HTTP 401）：API Key 无效，请检查', 401, $probeUrl);
            }

            if ($code === 200 || $code === 400 || $code === 404 || $code === 422) {
                // 这些状态都说明服务可达且鉴权通过（任务 id 不存在是正常的）
                return ProbeResult::ok(
                    "连接成功（HTTP {$code}），多米 API 官方当前仅支持模型：gpt-image-2",
                    $code,
                    $probeUrl,
                    [['id' => 'gpt-image-2']]
                );
            }

            if ($code === 403) {
                return ProbeResult::warning(
                    'API 地址可达，但 /v1/tasks 端点被拒绝（HTTP 403）。鉴权头可能格式错误，或 IP 白名单未配置。',
                    403,
                    $probeUrl
                );
            }
            if ($code >= 500) {
                return ProbeResult::error("多米上游服务器异常（HTTP {$code}），可稍后重试", $code, $probeUrl);
            }

            return ProbeResult::error("连接异常（HTTP {$code}）", $code, $probeUrl);
        } catch (Throwable $e) {
            Log::warning("[adapter.duomi.probe_models] provider={$provider->id} err=" . $e->getMessage());
            return ProbeResult::error('请求异常：' . $e->getMessage(), null, $probeUrl);
        }
    }

    /**
     * 多米不支持 chat，深度测试无意义。直接返回错误并提示用户走"基础测试"即可。
     */
    public function probeChat(CloudProvider $provider, string $apiKey, ?string $modelId = null, ?int $timeoutSeconds = null): ProbeResult
    {
        return ProbeResult::error(
            '多米 API 不支持 chat completions，无法做深度测试。请使用基础测试验证连接与鉴权。',
            null,
            ''
        );
    }
}
