<?php

namespace App\Services\CloudBuild;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class ArtifactDownloadService
{
    /**
     * Stream-download artifact to a tmp file, compute sha256 incrementally.
     *
     * @param string  $url
     * @param string  $expectedSha256
     * @param int|null $cloudBuildId  传入则下载过程中按 ~1 秒节流写 downloaded_bytes（前端轮询展示进度条）
     * @param string  $progressTable
     * @param int|null $fastFailConnectTimeout  非 null 时进入「快速失败」模式（直连优先尝试用）：
     *        用更短的连接超时，且中途持续低速即放弃 —— 便于连不上/慢时立刻回退下一候选(CDN)。
     *
     * @return array{tmp_path:string,size:int,sha256:string,verified:bool,error?:string}
     */
    public function downloadAndVerify(string $url, string $expectedSha256, ?int $cloudBuildId = null, string $progressTable = 'cloud_builds', ?int $fastFailConnectTimeout = null): array
    {
        $tmpDir = storage_path('app/cloud-builds/tmp');
        if (!is_dir($tmpDir) && !mkdir($tmpDir, 0755, true) && !is_dir($tmpDir)) {
            return $this->fail('mkdir_failed', $tmpDir);
        }

        $tmpPath = $tmpDir . DIRECTORY_SEPARATOR . Str::uuid() . '.bin';
        $fp = fopen($tmpPath, 'wb');
        if (!$fp) {
            return $this->fail('open_tmp_failed', $tmpPath);
        }

        $hashCtx = hash_init('sha256');
        $size = 0;
        $lastProgressUpdate = 0; // unix ts；节流：每秒最多写一次 DB

        $ch = curl_init($url);
        $curlOpts = [
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 5,
            CURLOPT_CONNECTTIMEOUT => $fastFailConnectTimeout ?? 30,
            CURLOPT_TIMEOUT => (int) config('cloudbuild.download.timeout_seconds', 1800),
            CURLOPT_USERAGENT => 'agent-admin/1.0',
            CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use ($fp, $hashCtx, &$size, $cloudBuildId, $progressTable, &$lastProgressUpdate) {
                fwrite($fp, $chunk);
                hash_update($hashCtx, $chunk);
                $size += strlen($chunk);

                // 节流写进度（每 1 秒一次）：避免高频 DB 写
                if ($cloudBuildId !== null && in_array($progressTable, ['cloud_builds', 'oem_builds'], true)) {
                    $now = time();
                    if ($now - $lastProgressUpdate >= 1) {
                        try {
                            DB::table($progressTable)
                                ->where('id', $cloudBuildId)
                                ->update([
                                    'downloaded_bytes' => $size,
                                    'updated_at' => now(),
                                ]);
                        } catch (\Throwable $e) {
                            // 进度更新失败不应中断下载
                        }
                        $lastProgressUpdate = $now;
                    }
                }

                return strlen($chunk);
            },
        ];
        if (!config('cloudbuild.agent_build.verify_ssl', false)) {
            $curlOpts[CURLOPT_SSL_VERIFYPEER] = false;
            $curlOpts[CURLOPT_SSL_VERIFYHOST] = 0;
        }
        if ($fastFailConnectTimeout !== null) {
            // 快速失败模式（直连优先）：连上后若持续 20s 低于 1KB/s 即中断，立刻回退下一候选。
            // 防家庭电脑「连得上但上行被打满/中途掉线」时一直挂到 30 分钟主超时。
            $curlOpts[CURLOPT_LOW_SPEED_LIMIT] = 1024;
            $curlOpts[CURLOPT_LOW_SPEED_TIME] = 20;
        }
        curl_setopt_array($ch, $curlOpts);

        $ok = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        fclose($fp);

        if (!$ok || $httpCode >= 400) {
            @unlink($tmpPath);
            Log::error('[ArtifactDownload] curl failed', [
                'url' => $url, 'http_code' => $httpCode, 'curl_error' => $err,
            ]);
            return $this->fail('curl_failed', "http=$httpCode err=$err");
        }

        $actualSha256 = hash_final($hashCtx);
        $verified = hash_equals(strtolower($expectedSha256), strtolower($actualSha256));

        if (!$verified) {
            @unlink($tmpPath);
            Log::warning('[ArtifactDownload] sha256 mismatch', [
                'expected' => $expectedSha256,
                'actual' => $actualSha256,
            ]);
            return [
                'tmp_path' => '',
                'size' => $size,
                'sha256' => $actualSha256,
                'verified' => false,
                'error' => 'sha256_mismatch',
            ];
        }

        return [
            'tmp_path' => $tmpPath,
            'size' => $size,
            'sha256' => $actualSha256,
            'verified' => true,
        ];
    }

    private function fail(string $code, string $detail = ''): array
    {
        return [
            'tmp_path' => '',
            'size' => 0,
            'sha256' => '',
            'verified' => false,
            'error' => $code . ($detail ? ': ' . $detail : ''),
        ];
    }
}
