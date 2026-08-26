<?php

namespace App\Http\Controllers\App\V1;

use App\Models\AppAsset;
use App\Support\AppV1Response;
use App\Services\StorageService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;

class AssetController
{
    private const MAX_BYTES = 20971520;
    private const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

    public function presign(Request $request)
    {
        if (($gate = $this->guard($request)) !== null) return $gate;
        $v = validator($request->all(), [
            'filename' => ['required', 'string', 'max:255'],
            'mime_type' => ['required', 'string'],
            'size' => ['required', 'integer', 'min:1', 'max:' . self::MAX_BYTES],
            'sha256' => ['nullable', 'regex:/^[a-f0-9]{64}$/'],
        ]);
        if ($v->fails()) return AppV1Response::error('validation_error', $v->errors()->first(), 422);
        $mime = strtolower(trim((string) $request->input('mime_type')));
        if (!in_array($mime, self::ALLOWED, true) || str_contains($mime, ';')) {
            return AppV1Response::error('invalid_mime', '仅支持 JPEG、PNG 或 WebP 图片', 422);
        }
        $filename = basename((string) $request->input('filename'));
        $filename = preg_replace('/[\x00-\x1F\x7F]+/u', '', $filename) ?: 'image';
        $filename = Str::limit($filename, 255, '');
        $id = (string) Str::uuid();
        $nonce = Str::random(48);
        $driver = StorageService::effectiveStorageType();
        $configured = StorageService::getStorageType();
        if (in_array($configured, ['cos', 'oss'], true) && $driver !== $configured) {
            return AppV1Response::error('storage_unavailable', '对象存储未就绪', 503);
        }
        $asset = AppAsset::create([
            'id' => $id,
            'user_id' => $request->user()->id,
            'kind' => 'image',
            'original_name' => $filename,
            'storage_driver' => $driver,
            'object_key' => 'app-assets/' . $id . '.' . ($mime === 'image/png' ? 'png' : ($mime === 'image/webp' ? 'webp' : 'jpg')),
            'declared_mime' => $mime,
            'expected_size' => (int) $request->input('size'),
            'sha256' => $request->input('sha256') ?: null,
            'status' => 'pending',
            'expires_at' => now()->addMinutes(15),
            'upload_expires_at' => now()->addMinutes(15),
            'nonce_hash' => hash('sha256', $nonce),
        ]);
        $url = URL::temporarySignedRoute('app.v1.assets.content.put', $asset->upload_expires_at, [
            'id' => $asset->id,
            'mime_type' => $mime,
            'size' => $asset->expected_size,
            'sha256' => $asset->sha256 ?: '',
            'nonce' => $nonce,
        ]);
        return AppV1Response::ok([
            'id' => $asset->id,
            'kind' => 'image',
            'status' => 'pending',
            'method' => 'PUT',
            'upload_url' => $url,
            'headers' => ['Content-Type' => $mime, 'X-Asset-Upload-Nonce' => $nonce],
            'max_size' => self::MAX_BYTES,
            'expires_at' => optional($asset->expires_at)->toISOString(),
            'upload_expires_at' => $asset->upload_expires_at->toISOString(),
        ], 201);
    }

    public function put(Request $request, string $id)
    {
        if (($gate = $this->guard($request)) !== null) return $gate;
        $asset = AppAsset::whereKey($id)->where('user_id', $request->user()->id)->first();
        if (!$asset) return AppV1Response::error('asset_not_found', 'Asset not found', 404);
        if ($asset->status !== 'pending') return AppV1Response::error('upload_consumed', '上传地址已使用', 409);
        if ($asset->upload_expires_at && $asset->upload_expires_at->isPast()) return AppV1Response::error('signature_expired', '上传地址已过期', 401);
        $nonce = (string) $request->query('nonce', '');
        if (!$nonce || !$asset->nonce_hash || !hash_equals($asset->nonce_hash, hash('sha256', $nonce))) {
            return AppV1Response::error('signature_invalid', '上传签名无效', 401);
        }
        if ((string) $request->query('mime_type', '') !== (string) $asset->declared_mime
            || (int) $request->query('size', 0) !== (int) $asset->expected_size
            || (string) $request->query('sha256', '') !== (string) ($asset->sha256 ?: '')) {
            return AppV1Response::error('signature_invalid', '上传签名参数不匹配', 401);
        }
        $contentLength = $request->header('Content-Length');
        if ($contentLength === null || !ctype_digit((string) $contentLength) || (int) $contentLength !== (int) $asset->expected_size) {
            return AppV1Response::error('size_mismatch', '文件大小不匹配', 422);
        }
        if (str_contains(strtolower((string) $request->header('Transfer-Encoding', '')), 'chunked')) {
            return AppV1Response::error('size_mismatch', '不支持分块上传', 422);
        }
        $declared = strtolower(trim((string) $request->header('Content-Type', '')));
        if ($declared !== $asset->declared_mime || !in_array($declared, self::ALLOWED, true)) {
            return AppV1Response::error('mime_mismatch', 'Content-Type 不匹配', 422);
        }
        $bytes = $request->getContent();
        if (strlen($bytes) !== (int) $asset->expected_size) return AppV1Response::error('size_mismatch', '文件大小不匹配', 422);
        if (!$this->validImage($bytes, $declared)) return AppV1Response::error('invalid_image', '图片内容无效', 422);
        $hash = hash('sha256', $bytes);
        if ($asset->sha256 && !hash_equals($asset->sha256, $hash)) return AppV1Response::error('asset_hash_mismatch', '文件校验失败', 422);

        // Atomically consume the nonce before writing so concurrent PUTs cannot overwrite the object.
        $claimed = AppAsset::whereKey($asset->id)->where('status', 'pending')->whereNull('consumed_at')
            ->update(['consumed_at' => now(), 'updated_at' => now()]);
        if ($claimed !== 1) return AppV1Response::error('upload_consumed', '上传地址已使用', 409);

        $written = StorageService::putPrivateBytes($bytes, $declared, 'app-assets', basename($asset->object_key));
        if (!$written) {
            $asset->update(['status' => 'failed']);
            return AppV1Response::error('storage_error', '文件保存失败', 503);
        }
        try {
            $asset->update([
                'storage_driver' => $written['driver'],
                'object_key' => $written['key'],
                'storage_url' => $written['url'],
                'actual_size' => strlen($bytes),
                'detected_mime' => $declared,
                'sha256' => $hash,
                'status' => 'uploaded',
            ]);
        } catch (\Throwable $e) {
            // Keep the failed asset for audit/retry, but remove an object that was
            // successfully written before the database update failed.
            StorageService::deleteWithDriver((string) ($written['url'] ?? ''), (string) ($written['driver'] ?? ''));
            $asset->update(['status' => 'failed']);
            return AppV1Response::error('storage_error', '文件保存失败', 503);
        }
        return AppV1Response::ok($this->present($asset));
    }

    public function complete(Request $request, string $id)
    {
        if (($gate = $this->guard($request)) !== null) return $gate;
        $asset = AppAsset::whereKey($id)->where('user_id', $request->user()->id)->first();
        if (!$asset) return AppV1Response::error('asset_not_found', 'Asset not found', 404);
        if ($asset->expires_at && $asset->expires_at->isPast()) return AppV1Response::error('asset_not_found', 'Asset not found', 404);
        if ($asset->status === 'ready') return AppV1Response::ok($this->present($asset));
        if ($asset->status !== 'uploaded') return AppV1Response::error('asset_not_ready', '资产尚未上传完成', 409);
        $bytes = StorageService::readBytes($asset->storage_url, $asset->storage_driver);
        if ($bytes === null || strlen($bytes) !== (int) $asset->expected_size || !$this->validImage($bytes, $asset->declared_mime)) {
            $asset->update(['status' => 'failed']);
            return AppV1Response::error('invalid_image', '资产完整性校验失败', 422);
        }
        $hash = hash('sha256', $bytes);
        if ($asset->sha256 && !hash_equals($asset->sha256, $hash)) {
            $asset->update(['status' => 'failed']);
            return AppV1Response::error('asset_hash_mismatch', '文件校验失败', 422);
        }
        $asset->update(['status' => 'ready', 'expires_at' => now()->addDay(), 'sha256' => $hash]);
        return AppV1Response::ok($this->present($asset->fresh()));
    }

    public function content(Request $request, string $id)
    {
        if (($gate = $this->guard($request)) !== null) return $gate;
        $asset = AppAsset::whereKey($id)->where('user_id', $request->user()->id)->where('status', 'ready')->first();
        if (!$asset || ($asset->expires_at && $asset->expires_at->isPast())) return AppV1Response::error('asset_not_found', 'Asset not found', 404);
        $bytes = StorageService::readBytes($asset->storage_url, $asset->storage_driver);
        if ($bytes === null) return AppV1Response::error('asset_not_found', 'Asset not found', 404);
        return response($bytes, 200, ['Content-Type' => $asset->detected_mime ?: $asset->declared_mime, 'Cache-Control' => 'private, max-age=600']);
    }

    private function guard(Request $request)
    {
        if (!config('app_v1.features.assets', false)) return AppV1Response::error('feature_disabled', '素材功能暂未开放', 503);
        $channel = (string) $request->header('X-Channel', 'web');
        if (!in_array($channel, ['h5', 'mini_program'], true)) return AppV1Response::error('channel_not_allowed', '当前渠道不支持素材上传', 403);
        return null;
    }

    private function validImage(string $bytes, string $declared): bool
    {
        if ($bytes === '' || strlen($bytes) > self::MAX_BYTES) return false;
        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        $detected = $finfo->buffer($bytes) ?: '';
        if ($detected !== $declared) return false;
        $info = @getimagesizefromstring($bytes);
        return is_array($info) && !empty($info['mime']) && $info['mime'] === $declared
            && (int) ($info[0] ?? 0) <= 4096 && (int) ($info[1] ?? 0) <= 4096;
    }

    private function present(AppAsset $asset): array
    {
        $displayExpiresAt = now()->addMinutes(10);
        $display = URL::temporarySignedRoute('app.v1.assets.content', $displayExpiresAt, ['id' => $asset->id]);
        return [
            'id' => (string) $asset->id,
            'kind' => (string) $asset->kind,
            'status' => (string) $asset->status,
            'mime' => (string) ($asset->detected_mime ?: $asset->declared_mime),
            'size' => (int) ($asset->actual_size ?: $asset->expected_size),
            'sha256' => (string) ($asset->sha256 ?: ''),
            'display_url' => $display,
            'display_url_expires_at' => $displayExpiresAt->toISOString(),
            'expires_at' => optional($asset->expires_at)->toISOString(),
        ];
    }
}
