<?php

namespace App\Http\Controllers;

use App\Models\SyncBlob;
use App\Models\SystemSetting;
use App\Services\StorageQuotaService;
use App\Services\StorageService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\File;

/**
 * 同步媒体 blob：秒传探测 + 分块断点续传上传 + 私有鉴权下载。
 *   - local：落 storage/app/sync-blobs/{user}/{sha}（非 public，私有）
 *   - cos/oss：经 StorageService 落对象存储，下载时服务端代理取流（不暴露公网直链）
 */
class BlobController extends Controller
{
    private const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB

    private function enabled(): bool
    {
        return (bool) SystemSetting::getValue('sync_enabled', true);
    }

    private function tmpDir(int $userId, string $sha): string
    {
        return storage_path("app/sync-tmp/{$userId}/{$sha}");
    }

    private function localPath(int $userId, string $sha): string
    {
        return storage_path("app/sync-blobs/{$userId}/{$sha}");
    }

    private function sanitizeSha(string $sha): string
    {
        return preg_match('/^[a-f0-9]{64}$/', $sha) ? $sha : '';
    }

    /** 秒传探测：返回云端缺失的 sha 列表 + 容量是否超限。 */
    public function check(Request $request)
    {
        if (!$this->enabled()) return response()->json(['error' => 'sync_disabled'], 403);
        $user = auth()->user();
        $items = $request->input('items', []);
        if (!is_array($items)) $items = [];

        $shas = array_values(array_filter(array_map(fn ($i) => $this->sanitizeSha((string) ($i['sha256'] ?? '')), $items)));
        $existing = SyncBlob::where('user_id', $user->id)
            ->whereIn('sha256', $shas)
            ->where('status', 'committed')
            ->pluck('sha256')
            ->all();
        $existingSet = array_flip($existing);

        // 续期 GC 宽限：客户端即将引用这些 blob（秒传跳过上传），刷新 updated_at
        // 防止「失引用超宽限 → 重新引用 → 恰被 sync:gc-blobs 回收」竞态
        if (!empty($existing)) {
            SyncBlob::where('user_id', $user->id)
                ->whereIn('sha256', $existing)
                ->update(['updated_at' => now()]);
        }

        $missing = [];
        $missingBytes = 0;
        foreach ($items as $i) {
            $sha = $this->sanitizeSha((string) ($i['sha256'] ?? ''));
            if ($sha === '' || isset($existingSet[$sha])) continue;
            $missing[] = $sha;
            $missingBytes += (int) ($i['size'] ?? 0);
        }

        $quota = app(StorageQuotaService::class);
        $exceeded = !$quota->canStore($user->id, $missingBytes);

        return response()->json(['missing' => array_values($missing), 'quota_exceeded' => $exceeded]);
    }

    /** 初始化分块上传，返回 chunk_size 与已上传分块（断点续传）。 */
    public function init(Request $request, string $sha)
    {
        if (!$this->enabled()) return response()->json(['error' => 'sync_disabled'], 403);
        $sha = $this->sanitizeSha($sha);
        if ($sha === '') return response()->json(['error' => 'invalid_sha'], 422);
        $user = auth()->user();
        $size = (int) $request->input('size', 0);

        $quota = app(StorageQuotaService::class);
        if ($size > $quota->maxBlobBytes()) {
            return response()->json(['error' => 'file_too_large'], 413);
        }
        if (!$quota->canStore($user->id, $size)) {
            return response()->json(['error' => 'quota_exceeded'], 413);
        }

        $dir = $this->tmpDir($user->id, $sha);
        File::ensureDirectoryExists($dir);
        $uploaded = [];
        foreach (glob($dir . '/*') ?: [] as $f) {
            $name = basename($f);
            if (is_numeric($name)) $uploaded[] = (int) $name;
        }

        return response()->json([
            'upload_id' => $sha,
            'chunk_size' => self::CHUNK_SIZE,
            'uploaded_chunks' => $uploaded,
        ]);
    }

    /** 上传单个分块（PUT 原始字节，?upload_id=&index=）。 */
    public function chunk(Request $request, string $sha)
    {
        if (!$this->enabled()) return response()->json(['error' => 'sync_disabled'], 403);
        $sha = $this->sanitizeSha($sha);
        if ($sha === '') return response()->json(['error' => 'invalid_sha'], 422);
        $user = auth()->user();
        $index = (int) $request->query('index', '-1');
        // index 上界 = maxBlobBytes / CHUNK_SIZE 的理论最大分块数，再宽放一个数量级
        if ($index < 0 || $index > 100000) return response()->json(['error' => 'invalid_index'], 422);

        $dir = $this->tmpDir($user->id, $sha);
        // 必须先 init（init 创建目录并做配额/大小校验）；否则可绕过校验直接堆积分块
        if (!is_dir($dir)) return response()->json(['error' => 'not_initialized'], 422);
        $body = $request->getContent();
        if ($body === '') return response()->json(['error' => 'empty_chunk'], 422);
        if (strlen($body) > 2 * self::CHUNK_SIZE) {
            return response()->json(['error' => 'chunk_too_large'], 413);
        }
        File::put($dir . '/' . $index, $body);
        return response()->json(['ok' => true]);
    }

    /** 合并分块、校验完整性、落存储、登记 committed、累加容量。 */
    public function complete(Request $request, string $sha)
    {
        if (!$this->enabled()) return response()->json(['error' => 'sync_disabled'], 403);
        $sha = $this->sanitizeSha($sha);
        if ($sha === '') return response()->json(['error' => 'invalid_sha'], 422);
        $user = auth()->user();
        $category = (string) $request->input('category', 'image');
        if (!in_array($category, ['image', 'video', 'data'], true)) $category = 'image';

        // 已存在（秒传/重复完成）：幂等返回
        $existing = SyncBlob::where('user_id', $user->id)->where('sha256', $sha)->first();
        if ($existing && $existing->status === 'committed') {
            $this->cleanupTmp($user->id, $sha);
            return response()->json(['ok' => true, 'size' => (int) $existing->size]);
        }

        $dir = $this->tmpDir($user->id, $sha);
        $files = array_values(array_filter(glob($dir . '/*') ?: [], fn ($f) => is_numeric(basename($f))));
        usort($files, fn ($a, $b) => (int) basename($a) <=> (int) basename($b));
        if (empty($files)) {
            return response()->json(['error' => 'empty_upload'], 422);
        }

        // 流式拼接分块到临时文件 + 流式 sha256（不整体入内存，适合大视频）
        $assembled = $dir . DIRECTORY_SEPARATOR . '__assembled';
        $ctx = hash_init('sha256');
        $out = @fopen($assembled, 'wb');
        if ($out === false) {
            $this->cleanupTmp($user->id, $sha);
            return response()->json(['error' => 'assemble_failed'], 500);
        }
        foreach ($files as $f) {
            hash_update_file($ctx, $f); // 分块读取，不整体入内存
            $in = @fopen($f, 'rb');
            if ($in === false) {
                fclose($out);
                $this->cleanupTmp($user->id, $sha);
                return response()->json(['error' => 'assemble_failed'], 500);
            }
            stream_copy_to_stream($in, $out);
            fclose($in);
        }
        fclose($out);

        // 完整性校验：内容寻址必须自洽
        if (hash_final($ctx) !== $sha) {
            $this->cleanupTmp($user->id, $sha);
            return response()->json(['error' => 'hash_mismatch'], 422);
        }

        $size = (int) @filesize($assembled);
        if ($size <= 0) {
            $this->cleanupTmp($user->id, $sha);
            return response()->json(['error' => 'empty_upload'], 422);
        }

        $quota = app(StorageQuotaService::class);
        if (!$quota->canStore($user->id, $size)) {
            $this->cleanupTmp($user->id, $sha);
            return response()->json(['error' => 'quota_exceeded'], 413);
        }

        $driver = StorageService::getStorageType();
        $storageUrl = '';
        if ($driver === 'local') {
            $path = $this->localPath($user->id, $sha);
            File::ensureDirectoryExists(dirname($path));
            if (!@rename($assembled, $path)) {
                if (!@copy($assembled, $path)) {
                    $this->cleanupTmp($user->id, $sha);
                    return response()->json(['error' => 'storage_failed'], 500);
                }
                @unlink($assembled);
            }
            $storageUrl = "sync-blobs/{$user->id}/{$sha}"; // 内部相对标识（非 public）
        } else {
            $url = StorageService::putFile($assembled, 'application/octet-stream', "sync/{$user->id}/blobs", $sha);
            @unlink($assembled);
            if (!$url) {
                $this->cleanupTmp($user->id, $sha);
                return response()->json(['error' => 'storage_failed'], 500);
            }
            $storageUrl = $url;
        }

        SyncBlob::updateOrCreate(
            ['user_id' => $user->id, 'sha256' => $sha],
            [
                'size' => $size,
                'category' => $category,
                'storage_driver' => $driver,
                'storage_url' => $storageUrl,
                'status' => 'committed',
            ],
        );
        $quota->addUsed($user->id, $size);
        $this->cleanupTmp($user->id, $sha);

        return response()->json(['ok' => true, 'size' => $size]);
    }

    /** 私有下载：local 流式、cos/oss 服务端代理取流。 */
    public function raw(Request $request, string $sha)
    {
        if (!$this->enabled()) return response()->json(['error' => 'sync_disabled'], 403);
        $sha = $this->sanitizeSha($sha);
        if ($sha === '') return response()->json(['error' => 'invalid_sha'], 422);
        $user = auth()->user();
        $blob = SyncBlob::where('user_id', $user->id)->where('sha256', $sha)->where('status', 'committed')->first();
        if (!$blob) return response()->json(['error' => 'not_found'], 404);

        if ($blob->storage_driver === 'local') {
            $path = $this->localPath($user->id, $sha);
            if (!is_file($path)) return response()->json(['error' => 'not_found'], 404);
            // BinaryFileResponse 流式发送，不整体入内存
            return response()->file($path, ['Content-Type' => 'application/octet-stream']);
        }

        // COS/OSS：优先预签名 URL 302 直连（流式、零服务器中转）
        $signed = StorageService::signedUrl($blob->storage_url, $blob->storage_driver, 1800);
        if ($signed) {
            return redirect()->away($signed);
        }

        // 兜底：签名不可用时服务端代理取流
        $bytes = StorageService::readBytes($blob->storage_url, $blob->storage_driver);
        if ($bytes === null) return response()->json(['error' => 'not_found'], 404);
        return response($bytes, 200, ['Content-Type' => 'application/octet-stream']);
    }

    private function cleanupTmp(int $userId, string $sha): void
    {
        $dir = $this->tmpDir($userId, $sha);
        if (is_dir($dir)) {
            File::deleteDirectory($dir);
        }
    }
}
