<?php

namespace App\Services\Koukoutu;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;
use Throwable;

/**
 * 抠抠图（koukoutu.com）通用抠图异步 API 封装（Image File 模式）。
 *
 * 调用流程：
 *   1. createTask(localPath): POST {base}/v1/create（multipart，image_file + model_key=background-removal
 *      + output_format=png + response=url），返回 data.task_id。
 *   2. pollResult(taskId): POST {base}/v1/query（x-www-form-urlencoded，task_id + model_key + response=url），
 *      轮询直到 data.result_file 有值（成功）或超时 / 失败。
 *
 * 返回结构（segmentLocalFile）：
 *   [
 *     'image_url'        => string,  // 抠抠图结果 URL（透明 PNG）
 *     'request_id'       => string,  // = provider_task_id（trace）
 *     'provider_task_id' => string,  // 抠抠图端 task_id
 *     'elapsed_ms'       => int,     // 端到端耗时
 *   ]
 *
 * 限制（来自抠抠图官方文档）：
 *   - 单图 ≤ 40MB，分辨率 ≤ 10000×10000
 *   - 格式：jpg / jpeg / png / webp
 *   - 单账号并发任务数 5（由 FineMattingConcurrencyLimiter 在上层控制）
 *
 * 异常分类：
 *   - InvalidArgumentException：本地校验失败（文件不存在 / 超尺寸 / 格式不支持）
 *   - RuntimeException：上游网络 / 业务错误，调用方应捕获后写 task.error
 */
class KoukoutuMattingService
{
    private string $apiKey = '';
    private array $cfg;

    public function __construct()
    {
        $this->cfg = config('koukoutu.fine_matting');
    }

    /**
     * 注入凭证后才能调 segmentLocalFile()。API Key 由 Controller 从 SystemSetting
     * (fine_matting_api_key) 读取并传入，Service 不直接押设凭证来源。
     */
    public function configure(string $apiKey): void
    {
        if (trim($apiKey) === '') {
            throw new RuntimeException('精细抠图服务尚未配置 API Key（请在「精细抠图 → 自定义设置」填写）');
        }
        $this->apiKey = trim($apiKey);
    }

    private function assertConfigured(): void
    {
        if ($this->apiKey === '') {
            throw new RuntimeException('KoukoutuMattingService 未初始化：调用前需先 configure($apiKey)');
        }
    }

    /**
     * 用本地文件路径调抠抠图（create → poll）。
     *
     * @return array{image_url:string,request_id:string,provider_task_id:string,elapsed_ms:int}
     * @throws \InvalidArgumentException 本地校验不通过
     * @throws RuntimeException 上游错误
     */
    public function segmentLocalFile(string $localPath): array
    {
        $this->assertConfigured();
        $this->assertLocalFileValid($localPath);

        $start = microtime(true);
        $taskId = $this->createTask($localPath);
        return $this->pollResult($taskId, $start);
    }

    private function createTask(string $localPath): string
    {
        $base = rtrim((string) $this->cfg['base_url'], '/');
        $httpTimeout = (int) ($this->cfg['http_timeout_seconds'] ?? 30);

        $contents = @file_get_contents($localPath);
        if ($contents === false) {
            throw new RuntimeException("无法读取本地文件：{$localPath}");
        }

        try {
            $resp = Http::withHeaders(['X-API-Key' => $this->apiKey])
                ->timeout($httpTimeout)
                ->attach('image_file', $contents, basename($localPath))
                ->post("{$base}/v1/create", [
                    'model_key'     => (string) ($this->cfg['model_key'] ?? 'background-removal'),
                    'output_format' => (string) ($this->cfg['output_format'] ?? 'png'),
                    'crop'          => '0',
                    'border'        => '0',
                    'stamp_crop'    => '0',
                    'response'      => 'url',
                ]);
        } catch (Throwable $e) {
            throw new RuntimeException('抠抠图创建任务网络错误：' . $e->getMessage(), 0, $e);
        }

        $body = $resp->json();
        if (!is_array($body)) {
            throw new RuntimeException('抠抠图创建任务返回非 JSON（HTTP ' . $resp->status() . '）');
        }

        $code = (int) ($body['code'] ?? 0);
        if ($code !== 200) {
            $msg = (string) ($body['message'] ?? ('HTTP ' . $resp->status()));
            throw new RuntimeException("抠抠图创建任务失败：{$msg}");
        }

        $taskId = $body['data']['task_id'] ?? null;
        if ($taskId === null || $taskId === '') {
            throw new RuntimeException('抠抠图创建任务未返回 task_id');
        }
        return (string) $taskId;
    }

    private function pollResult(string $taskId, float $start): array
    {
        $base = rtrim((string) $this->cfg['base_url'], '/');
        $interval = max(1, (int) ($this->cfg['poll_interval_seconds'] ?? 1));
        $timeout = max($interval, (int) ($this->cfg['poll_timeout_seconds'] ?? 120));
        $httpTimeout = (int) ($this->cfg['http_timeout_seconds'] ?? 30);
        $modelKey = (string) ($this->cfg['model_key'] ?? 'background-removal');
        $deadline = time() + $timeout;

        do {
            sleep($interval);

            try {
                $resp = Http::withHeaders(['X-API-Key' => $this->apiKey])
                    ->asForm()
                    ->timeout($httpTimeout)
                    ->post("{$base}/v1/query", [
                        'task_id'   => $taskId,
                        'model_key' => $modelKey,
                        'response'  => 'url',
                    ]);
            } catch (Throwable $e) {
                // 网络抖动：不立即失败，继续轮询直到超时
                Log::warning("[Koukoutu] query 网络错误: {$e->getMessage()}", ['task_id' => $taskId]);
                continue;
            }

            $body = $resp->json();
            if (!is_array($body)) {
                continue;
            }

            $code = (int) ($body['code'] ?? 0);
            // code 非 0 且非 200 视为明确业务错误（0 表示未解析到，保守继续）
            if ($code !== 200 && $code !== 0) {
                throw new RuntimeException('抠抠图查询失败：' . ((string) ($body['message'] ?? ('code ' . $code))));
            }

            $data = is_array($body['data'] ?? null) ? $body['data'] : [];
            $resultFile = (string) ($data['result_file'] ?? '');
            if ($resultFile !== '') {
                return [
                    'image_url'        => $resultFile,
                    'request_id'       => $taskId,
                    'provider_task_id' => $taskId,
                    'elapsed_ms'       => (int) round((microtime(true) - $start) * 1000),
                ];
            }

            $state = $data['state'] ?? null;
            $combinedMsg = strtolower((string) ($body['message'] ?? '') . ' ' . (string) ($data['message'] ?? ''));

            if (str_contains($combinedMsg, 'fail')
                || str_contains($combinedMsg, 'error')
                || str_contains($combinedMsg, 'timeout')
                || (is_numeric($state) && (int) $state < 0)
            ) {
                $emsg = (string) ($data['message'] ?? $body['message'] ?? '任务失败');
                throw new RuntimeException("抠抠图任务失败：{$emsg} (task={$taskId})");
            }
            // running / 其它中间态 → 继续轮询
        } while (time() < $deadline);

        throw new RuntimeException("抠抠图任务查询超时 (task={$taskId})");
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

        $maxSize = (int) $this->cfg['max_file_size_bytes'];
        if ($size > $maxSize) {
            $mb = round($maxSize / 1024 / 1024, 1);
            throw new \InvalidArgumentException("文件超过 {$mb}MB 限制（当前 " . round($size / 1024 / 1024, 2) . "MB）");
        }

        $ext = strtolower(pathinfo($localPath, PATHINFO_EXTENSION));
        $allowed = $this->cfg['allowed_extensions'] ?? ['png', 'jpg', 'jpeg', 'webp'];
        if (!in_array($ext, $allowed, true)) {
            throw new \InvalidArgumentException(
                "不支持的格式 .{$ext}（仅支持 " . implode('/', $allowed) . "）"
            );
        }
    }
}
