<?php

namespace App\Services\Video;

use App\Models\SystemSetting;
use App\Models\VideoProviderAccount;
use App\Models\VideoResult;
use App\Models\VideoTask;
use App\Services\StorageService;
use GuzzleHttp\Client;

class VideoAssetService
{
    public function storeRemoteResult(VideoTask $task, string $remoteUrl, string $coverUrl = '', array $metadata = []): VideoResult
    {
        $mode = (string)SystemSetting::getValue('video_result_storage_mode', 'remote_url_only');
        $storageUrl = '';
        $storageStatus = 'remote_url_only';

        if ($mode === 'cloud_storage' && $remoteUrl !== '') {
            $stored = $this->mirrorRemoteUrl($remoteUrl, 'video-results', $task->id . '.mp4', $task->account);
            if ($stored !== '') {
                $storageUrl = $this->absoluteUrl($stored);
                $storageStatus = 'cloud_storage';
            } else {
                $storageStatus = 'mirror_failed';
            }
        }

        return VideoResult::updateOrCreate(
            ['video_task_id' => $task->id],
            [
                'user_id' => $task->user_id,
                'remote_url' => $remoteUrl,
                'storage_url' => $storageUrl,
                'cover_url' => $coverUrl,
                'duration_seconds' => (int)($metadata['duration_seconds'] ?? $task->request_params['duration'] ?? 0),
                'width' => (int)($metadata['width'] ?? 0),
                'height' => (int)($metadata['height'] ?? 0),
                'mime_type' => (string)($metadata['mime_type'] ?? 'video/mp4'),
                'file_size' => (int)($metadata['file_size'] ?? 0),
                'storage_status' => $storageStatus,
                'metadata' => $metadata,
            ]
        );
    }

    private function mirrorRemoteUrl(string $url, string $subdir, string $filename, ?VideoProviderAccount $account = null): string
    {
        try {
            // 当结果 URL 指向服务商自身鉴权端点（如 cang-api 新契约的 /v1/videos/{id}/content）时，
            // 附带该账号的鉴权头，否则裸 GET 会 401；仅同主机时附带，避免把 key 泄露给外链/CDN。
            $options = ['http_errors' => false];
            $headers = $this->downloadHeadersFor($url, $account);
            if (!empty($headers)) {
                $options['headers'] = $headers;
            }
            $client = new Client(['timeout' => 120, 'http_errors' => false]);
            $resp = $client->get($url, $options);
            if ($resp->getStatusCode() < 200 || $resp->getStatusCode() >= 300) return '';
            $bytes = (string)$resp->getBody();
            if ($bytes === '') return '';
            $contentType = $resp->getHeaderLine('Content-Type') ?: 'video/mp4';
            return StorageService::putBytes($bytes, $contentType, $subdir, $filename) ?: '';
        } catch (\Throwable) {
            return '';
        }
    }

    /**
     * 下载结果视频时的鉴权头：当 URL 主机与服务商 base_url 同源且账号有 key 时附带 Authorization，
     * 否则返回空数组（外链/公共直链不带 key）。
     *
     * @return array<string, string>
     */
    private function downloadHeadersFor(string $url, ?VideoProviderAccount $account): array
    {
        if (!$account || (string)$account->api_key === '' || (string)$account->base_url === '') {
            return [];
        }
        // 同源判定收紧到 scheme + host + port：避免把 key 经明文 http / 异常端口带出（防降级泄露）。
        $u = parse_url($url);
        $b = parse_url((string)$account->base_url);
        $urlHost = (string)($u['host'] ?? '');
        $baseHost = (string)($b['host'] ?? '');
        if ($urlHost === '' || $baseHost === '' || strcasecmp($urlHost, $baseHost) !== 0) {
            return [];
        }
        $urlScheme = strtolower((string)($u['scheme'] ?? ''));
        $baseScheme = strtolower((string)($b['scheme'] ?? ''));
        if ($urlScheme === '' || $urlScheme !== $baseScheme) {
            return [];
        }
        $defaultPort = $urlScheme === 'https' ? 443 : 80;
        if ((int)($u['port'] ?? $defaultPort) !== (int)($b['port'] ?? $defaultPort)) {
            return [];
        }
        $authStyle = (string)($account->auth_style ?: 'bearer');
        $value = $authStyle === 'raw_authorization_header'
            ? (string)$account->api_key
            : 'Bearer ' . (string)$account->api_key;
        return ['Authorization' => $value];
    }

    private function absoluteUrl(string $url): string
    {
        if ($url === '' || str_starts_with($url, 'http://') || str_starts_with($url, 'https://')) return $url;
        return rtrim((string)config('app.url'), '/') . $url;
    }
}
