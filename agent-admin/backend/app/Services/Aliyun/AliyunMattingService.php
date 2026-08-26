<?php

namespace App\Services\Aliyun;

use AlibabaCloud\SDK\Imageseg\V20191230\Models\SegmentHDCommonImageRequest;
use AlibabaCloud\SDK\Imageseg\V20191230\Models\SegmentHDCommonImageAdvanceRequest;
use AlibabaCloud\SDK\Imageseg\V20191230\Models\GetAsyncJobResultRequest;
use AlibabaCloud\Dara\Models\RuntimeOptions;
use Darabonba\OpenApi\Models\Config as OpenApiConfig;
use GuzzleHttp\Psr7\Utils as Psr7Utils;
use Illuminate\Support\Facades\Log;
use RuntimeException;
use Throwable;

/**
 * 阿里云 viapi 通用高清抠图（universal-hd-split / SegmentHDCommonImage）封装。
 *
 * 两种调用模式：
 *   - segmentLocalFile(localPath): 走 Advance API，SDK 内部自动上传到阿里临时 OSS，
 *     再调真实接口。**唯一支持本地文件无损直传的方式**，无需自建 OSS。
 *   - segmentImageUrl(publicUrl): 走普通 API，要求图片地址公网可访问且开放跨域。
 *
 * 返回结构（两个方法一致）：
 *   [
 *     'image_url'    => string,  // 处理结果（透明 PNG）的临时 URL，24h 有效
 *     'request_id'   => string,  // 阿里端 RequestId，用于日志 trace
 *     'elapsed_ms'   => int,     // 端到端耗时（含上传 OSS）
 *   ]
 *
 * 限制（来自阿里官方文档）：
 *   - 单图 ≤ 40MB
 *   - 长边 32-10000px
 *   - 格式：jpg / jpeg / png / bmp
 *   - 同步等待最长约 60s（多数图片 <10s），SDK readTimeout 默认 90s
 *
 * 异常分类：
 *   - InvalidArgumentException：本地校验失败（文件不存在 / 超尺寸 / 格式不支持）
 *   - RuntimeException：上游网络 / SDK / 业务错误，调用方应捕获后写 task.error
 */
class AliyunMattingService
{
    private ?PatchedImageseg $client = null;
    private array $matCfg;

    public function __construct()
    {
        // 限流 / 超时 / 文件限制仍走 config（不需要管理员调）。
        // 凭证仅在 configure() 被调用后才初始化 client。
        $this->matCfg = config('aliyun.matting');
    }

    /**
     * 注入凭证后才能调 segment*()。凭证由 Controller 从 SystemSetting (matting_*) 读取并传入，
     * Service 不直接押设凭证从哪里来（便于单元测试 / 未来多租户）。
     *
     * @param array{access_key_id:string,access_key_secret:string,endpoint?:string,region_id?:string} $creds
     */
    public function configure(array $creds): void
    {
        if (empty($creds['access_key_id']) || empty($creds['access_key_secret'])) {
            throw new RuntimeException('AI 抠图服务尚未配置 AccessKey（请在「AI 抠图 → 自定义设置」填写）');
        }

        $cfg = new OpenApiConfig([
            'accessKeyId'     => $creds['access_key_id'],
            'accessKeySecret' => $creds['access_key_secret'],
            'endpoint'        => $creds['endpoint']  ?? 'imageseg.cn-shanghai.aliyuncs.com',
            'regionId'        => $creds['region_id'] ?? 'cn-shanghai',
        ]);

        // 用 PatchedImageseg 而非 Imageseg：补 SDK 4.0 引用但父类未声明的 $_retryOptions 字段。
        // 详细见 PatchedImageseg.php 类注释。
        $this->client = new PatchedImageseg($cfg);
    }

    private function assertConfigured(): void
    {
        if ($this->client === null) {
            throw new RuntimeException('AliyunMattingService 未初始化：调用前需先 configure(\$creds)');
        }
    }

    /**
     * 用本地文件路径调阿里抠图。SDK 内部自动上传到临时 OSS。
     *
     * @param string $localPath 本地图片绝对路径
     * @return array{image_url:string,request_id:string,elapsed_ms:int}
     * @throws \InvalidArgumentException 本地校验不通过
     * @throws RuntimeException 上游错误
     */
    public function segmentLocalFile(string $localPath): array
    {
        $this->assertConfigured();
        $this->assertLocalFileValid($localPath);

        $resource = fopen($localPath, 'rb');
        if ($resource === false) {
            throw new RuntimeException("无法打开本地文件：{$localPath}");
        }
        $stream = Psr7Utils::streamFor($resource);

        // SDK 字段名是 imageUrlObject（小写 url）不是 imageURLObject。写错大小写 → SDK 跳过 OSS 上传分支
        // → 真实请求 ImageUrl 为空 → 阿里返回 「ImageUrl is mandatory for this action. [MissingImageUrl]」。
        $req = new SegmentHDCommonImageAdvanceRequest([
            'imageUrlObject' => $stream,
        ]);

        $start = microtime(true);
        try {
            $resp = $this->client->segmentHDCommonImageAdvance($req, $this->buildRuntime());
        } catch (Throwable $e) {
            $stream->close();
            $msg = $this->extractErrorMessage($e);
            Log::warning("[AliyunMatting] segmentHDCommonImageAdvance failed: {$msg}", [
                'local_path' => $localPath,
            ]);
            throw new RuntimeException($msg, 0, $e);
        }

        $stream->close();

        return $this->parseResponse($resp, $start);
    }

    /**
     * 用公网 URL 调阿里抠图。要求图片可公开访问且支持跨域。
     *
     * @return array{image_url:string,request_id:string,elapsed_ms:int}
     */
    public function segmentImageUrl(string $publicUrl): array
    {
        $this->assertConfigured();
        // SDK 字段名是 imageUrl（小写 url），同上。
        $req = new SegmentHDCommonImageRequest([
            'imageUrl' => $publicUrl,
        ]);

        $start = microtime(true);
        try {
            // 注：segmentHDCommonImage 是单参方法，不接受 runtime（有则会被忽略或丢 警告）。
            // Advance 版本才是双参（需要 runtime 控制 OSS 上传超时）。
            $resp = $this->client->segmentHDCommonImage($req);
        } catch (Throwable $e) {
            $msg = $this->extractErrorMessage($e);
            Log::warning("[AliyunMatting] segmentHDCommonImage failed: {$msg}", [
                'image_url' => $publicUrl,
            ]);
            throw new RuntimeException($msg, 0, $e);
        }

        return $this->parseResponse($resp, $start);
    }

    /**
     * 解析 SDK 返回的统一响应结构。
     * 阿里返回 body->data->imageURL (或 imageUrl 大小写不一致)；做兼容兜底。
     */
    private function parseResponse($resp, float $start): array
    {
        $body      = $resp->body ?? null;
        $requestId = $body->requestId ?? '';
        $data      = $body->data ?? null;

        if (!$data) {
            if ($this->isAsyncSubmitted($body, $requestId)) {
                return $this->waitForAsyncResult($requestId, $start);
            }
            $code = $body->code ?? '';
            $msg  = $body->message ?? '上游返回空 data';
            throw new RuntimeException("阿里抠图失败 [{$code}] {$msg} (req={$requestId})");
        }

        $imageUrl = $this->pickImageUrl($data);
        if (empty($imageUrl)) {
            if ($this->isAsyncSubmitted($body, $requestId)) {
                return $this->waitForAsyncResult($requestId, $start);
            }
            throw new RuntimeException("阿里抠图返回 data.imageURL 为空 (req={$requestId})");
        }

        return [
            'image_url'  => $imageUrl,
            'request_id' => $requestId,
            'elapsed_ms' => (int) round((microtime(true) - $start) * 1000),
        ];
    }

    private function waitForAsyncResult(string $jobId, float $start): array
    {
        $interval = max(1, (int) ($this->matCfg['poll_interval_seconds'] ?? 2));
        $timeout = max($interval, (int) ($this->matCfg['poll_timeout_seconds'] ?? 60));
        $deadline = time() + $timeout;

        do {
            sleep($interval);

            try {
                $resp = $this->client->getAsyncJobResultWithOptions(
                    new GetAsyncJobResultRequest(['jobId' => $jobId]),
                    $this->buildRuntime()
                );
            } catch (Throwable $e) {
                $msg = $this->extractErrorMessage($e);
                Log::warning("[AliyunMatting] getAsyncJobResult failed: {$msg}", [
                    'job_id' => $jobId,
                ]);
                throw new RuntimeException($msg, 0, $e);
            }

            $data = $resp->body->data ?? null;
            if (!$data) {
                continue;
            }

            $status = strtoupper((string) ($data->status ?? ''));
            $imageUrl = $this->pickImageUrlFromAsyncResult((string) ($data->result ?? ''));
            if ($imageUrl !== '') {
                return [
                    'image_url'  => $imageUrl,
                    'request_id' => $jobId,
                    'elapsed_ms' => (int) round((microtime(true) - $start) * 1000),
                ];
            }

            if (in_array($status, ['PROCESS_SUCCESS', 'SUCCESS', 'SUCCEEDED', 'COMPLETED'], true)) {
                throw new RuntimeException("阿里抠图异步任务成功但结果为空 (job={$jobId})");
            }

            if (str_contains($status, 'FAIL') || str_contains($status, 'ERROR') || str_contains($status, 'TIMEOUT')) {
                $code = $data->errorCode ?? '';
                $msg = $data->errorMessage ?? '异步任务失败';
                throw new RuntimeException("阿里抠图异步任务失败 [{$code}] {$msg} (job={$jobId})");
            }
        } while (time() < $deadline);

        throw new RuntimeException("阿里抠图异步任务查询超时 (job={$jobId})");
    }

    private function isAsyncSubmitted($body, string $requestId): bool
    {
        if ($requestId === '') {
            return false;
        }
        $msg = (string) ($body->message ?? '');
        return str_contains($msg, 'GetAsyncJobResult')
            || str_contains($msg, '异步调用')
            || str_contains($msg, 'jobId');
    }

    private function pickImageUrl($data): string
    {
        foreach (['imageURL', 'imageUrl', 'ImageUrl', 'ImageURL', 'image_url'] as $key) {
            if (is_object($data) && !empty($data->{$key})) {
                return (string) $data->{$key};
            }
            if (is_array($data) && !empty($data[$key])) {
                return (string) $data[$key];
            }
        }
        return '';
    }

    private function pickImageUrlFromAsyncResult(string $result): string
    {
        $decoded = json_decode($result, true);
        if (is_array($decoded)) {
            $imageUrl = $this->pickImageUrl($decoded);
            if ($imageUrl !== '') {
                return $imageUrl;
            }
        }

        if (preg_match('/https?:\/\/[^\s"\\\\]+/', $result, $m)) {
            return $m[0];
        }

        return '';
    }

    private function buildRuntime(): RuntimeOptions
    {
        // 抠图同步等待最长 60s（业务侧），SDK 读超时给 90s 兜底
        return new RuntimeOptions([
            'readTimeout'    => ($this->matCfg['poll_timeout_seconds'] + 30) * 1000,
            'connectTimeout' => 10 * 1000,
            'autoretry'      => false, // 重试由上层 Job tries 控制，避免双重重试
            'maxAttempts'    => 1,
        ]);
    }

    private function assertLocalFileValid(string $localPath): void
    {
        if (!is_file($localPath)) {
            throw new \InvalidArgumentException("文件不存在：{$localPath}");
        }

        $size = filesize($localPath);
        if ($size === false || $size <= 0) {
            throw new \InvalidArgumentException("文件为空或无法读取：{$localPath}");
        }

        $maxSize = (int) $this->matCfg['max_file_size_bytes'];
        if ($size > $maxSize) {
            $mb = round($maxSize / 1024 / 1024, 1);
            throw new \InvalidArgumentException("文件超过 {$mb}MB 限制（当前 " . round($size / 1024 / 1024, 2) . "MB）");
        }

        $ext = strtolower(pathinfo($localPath, PATHINFO_EXTENSION));
        $allowed = $this->matCfg['allowed_extensions'] ?? ['png', 'jpg', 'jpeg', 'bmp'];
        if (!in_array($ext, $allowed, true)) {
            throw new \InvalidArgumentException(
                "不支持的格式 .{$ext}（仅支持 " . implode('/', $allowed) . "）"
            );
        }
    }

    /**
     * 从 SDK 异常里提取可读错误消息（兼容 TeaError / TeaUnretryableError 等）。
     */
    private function extractErrorMessage(Throwable $e): string
    {
        // TeaError 通常带 code + data
        $data = get_object_vars($e)['data'] ?? null;
        if (is_array($data) && !empty($data['Message'])) {
            return $data['Message'] . (isset($data['Code']) ? " [{$data['Code']}]" : '');
        }
        if (is_object($data) && property_exists($data, 'Message')) {
            return $data->Message . (property_exists($data, 'Code') ? " [{$data->Code}]" : '');
        }
        return $e->getMessage() ?: 'Unknown SDK error';
    }
}
