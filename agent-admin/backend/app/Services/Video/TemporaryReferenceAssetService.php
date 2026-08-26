<?php

namespace App\Services\Video;

use App\Models\TemporaryReferenceAsset;
use App\Models\User;
use App\Services\StorageService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class TemporaryReferenceAssetService
{
    /**
     * 上传一份临时参考素材到对象存储并落库。
     *
     * @param string   $subdir      存储子目录（视频参考图默认 video-reference-assets；
     *                              图片生成参考图传 image-reference-assets 便于区分与定向清理）
     * @param int|null $expireHours 过期小时数（null = 24h；图片生成参考图用更短的窗口，
     *                              够上游拉取即可，由 video:purge-reference-assets 清理）
     */
    public function upload(
        User $user,
        UploadedFile $file,
        string $assetType = 'image',
        string $subdir = 'video-reference-assets',
        ?int $expireHours = null
    ): TemporaryReferenceAsset {
        $assetType = in_array($assetType, ['image', 'video', 'audio'], true) ? $assetType : 'image';
        $extension = strtolower($file->getClientOriginalExtension() ?: $file->extension() ?: 'bin');
        $filename = Str::uuid()->toString() . '.' . $extension;
        $url = StorageService::uploadAbsolute($file, $subdir, $filename);
        if (!$url) {
            throw new \RuntimeException('参考素材上传失败');
        }
        // local 存储且文件落在 public 之外（public 不可写 → storage 兜底目录，见 StorageService::writableLocalDir）时，
        // 按 public 直链外部访问会 404，导致上游服务商回拉参考图失败、桌面端预览也打不开（视频链路无
        // base64 materialize 兜底）。改用服务路由 URL，由公开端点经 readBytes 从兜底目录回流，保证可拉；
        // cos/oss 或 public 可写时保持原直链/预签名不变（isPublicServable=true 直接返回原 url）。
        $key = trim($subdir, '/') . '/' . $filename;
        if (StorageService::effectiveStorageType() === 'local' && !StorageService::isPublicServable($key)) {
            $url = StorageService::referenceBlobUrl($key);
        }

        return TemporaryReferenceAsset::create([
            'user_id' => $user->id,
            'asset_type' => $assetType,
            'source' => 'upload',
            'original_url' => '',
            'storage_url' => $url,
            // 记录实际落地后端（cos/oss 半配置会被 effectiveStorageType 降级为 local），
            // 保证后续 materialize/readBytes 按同一后端读得回，而非按配置的名义后端读空。
            'storage_driver' => StorageService::effectiveStorageType(),
            'mime_type' => (string)($file->getMimeType() ?: ''),
            'file_size' => (int)$file->getSize(),
            'status' => 'active',
            'expires_at' => now()->addHours($expireHours ?? 24),
            'metadata' => [
                'original_name' => $file->getClientOriginalName(),
                'extension' => $extension,
            ],
        ]);
    }

    public function attachUrls(User $user, array $urls, string $assetType = 'image'): array
    {
        $out = [];
        foreach ($urls as $url) {
            if (!is_string($url) || !preg_match('#^https?://#i', $url)) continue;
            $asset = TemporaryReferenceAsset::create([
                'user_id' => $user->id,
                'asset_type' => $assetType,
                'source' => 'url',
                'original_url' => $url,
                'storage_url' => $url,
                'storage_driver' => 'external',
                'mime_type' => '',
                'file_size' => 0,
                'status' => 'active',
                'expires_at' => now()->addHours(24),
                'metadata' => [],
            ]);
            $out[] = $asset->storage_url;
        }
        return $out;
    }

    public function bindToTask(array $urls, string $taskId, ?int $userId = null): void
    {
        if (empty($urls)) return;
        $query = TemporaryReferenceAsset::whereIn('storage_url', $urls);
        if ($userId !== null) $query->where('user_id', $userId);
        $query->update(['video_task_id' => $taskId]);
    }

    /**
     * 删除一批临时素材：先删存储文件（仅本站上传的素材），再删数据库记录。
     *
     * @param int[]    $ids
     * @param int|null $userId 限定归属用户（客户端自助删除时传；后台管理传 null）
     * @return array{deleted:int, errors:array<int,array{id:int,error:string}>, total:int}
     */
    public function deleteAssets(array $ids, ?int $userId = null): array
    {
        $ids = array_values(array_unique(array_map('intval', $ids)));
        if (empty($ids)) {
            return ['deleted' => 0, 'errors' => [], 'total' => 0];
        }

        $query = TemporaryReferenceAsset::whereIn('id', $ids);
        if ($userId !== null) $query->where('user_id', $userId);
        $assets = $query->get();

        $deleted = 0;
        $errors = [];
        foreach ($assets as $asset) {
            try {
                if ($this->deleteOne($asset)) $deleted++;
            } catch (\Throwable $e) {
                $errors[] = ['id' => (int) $asset->id, 'error' => $e->getMessage()];
            }
        }

        return ['deleted' => $deleted, 'errors' => $errors, 'total' => count($ids)];
    }

    /**
     * 清理已过期的临时素材：expires_at 早于 (now - grace) 的记录连同文件一并删除。
     *
     * @param int $limit        单次最多清理条数（防止一次扫太多拖垮 DB / 存储 API）
     * @param int $graceMinutes 过期后的宽限分钟数（避免删掉刚过期但任务仍在引用的素材）
     * @return int 实际清理的条数
     */
    public function purgeExpired(int $limit = 500, int $graceMinutes = 0): int
    {
        $limit = max(1, min(5000, $limit));
        $cutoff = now()->subMinutes(max(0, $graceMinutes));

        $assets = TemporaryReferenceAsset::whereNotNull('expires_at')
            ->where('expires_at', '<', $cutoff)
            ->orderBy('id')
            ->limit($limit)
            ->get();

        $deleted = 0;
        foreach ($assets as $asset) {
            try {
                if ($this->deleteOne($asset)) $deleted++;
            } catch (\Throwable $e) {
                Log::warning('[temp-asset:purge] delete failed id=' . $asset->id . ': ' . $e->getMessage());
            }
        }

        return $deleted;
    }

    /**
     * 删除单条素材：source=upload 的文件落在本站存储，best-effort 删文件后删记录；
     * source=url 是外链（storage_url 即第三方地址），只删数据库记录、不动外部资源。
     */
    private function deleteOne(TemporaryReferenceAsset $asset): bool
    {
        if ($asset->source === 'upload' && (string) $asset->storage_url !== '') {
            // 删文件失败不阻塞删记录：宁可留孤儿文件待运维清理，也不留无文件的死记录。
            // 按记录当初的存储后端删除：切换 storage_type 后仍能清掉历史文件（driver 为空回退当前全局）。
            StorageService::deleteWithDriver((string) $asset->storage_url, $asset->storage_driver);
        }
        return (bool) $asset->delete();
    }
}
