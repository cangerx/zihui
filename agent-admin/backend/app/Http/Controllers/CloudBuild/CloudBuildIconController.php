<?php

namespace App\Http\Controllers\CloudBuild;

use App\Http\Controllers\Controller;
use App\Services\StorageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

/**
 * Cloud-build icon upload (admin-only).
 *
 * Constraints:
 *   - format : PNG only (electron-builder auto-converts PNG to .ico/.icns at build time)
 *   - aspect : 1:1 (square)
 *   - size   : 512x512 to 1024x1024
 *   - bytes  : <= 2 MB
 *
 * Stored at public/cloud-build/icons/{uuid}.png. Returned as absolute URL,
 * which is then passed verbatim to agent-build then to GitHub Actions runner
 * (runner curl-downloads it to build/icon.png for electron-builder).
 */
class CloudBuildIconController extends Controller
{
    private const MIN_SIZE = 512;
    private const MAX_SIZE = 1024;
    private const MAX_BYTES = 2 * 1024 * 1024;
    private const CUSTOMER_SERVICE_MAX_BYTES = 5 * 1024 * 1024;
    private const SUBDIR = 'cloud-build/icons';
    private const CUSTOMER_SERVICE_SUBDIR = 'cloud-build/customer-service';
    private const LOGIN_BG_SUBDIR = 'cloud-build/login-bg';
    private const BOT_LIST_BG_SUBDIR = 'cloud-build/bot-list-bg';

    public function upload(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'icon' => [
                'required',
                'file',
                'mimetypes:image/png',
                'mimes:png',
                'max:' . (int) (self::MAX_BYTES / 1024),
            ],
        ]);
        if ($validator->fails()) {
            return response()->json([
                'error' => 'validation_failed',
                'details' => $validator->errors(),
            ], 422);
        }

        $file = $request->file('icon');

        $info = @getimagesize($file->getRealPath());
        if (!$info || ($info[2] ?? null) !== IMAGETYPE_PNG) {
            return response()->json(['error' => 'not_a_real_png'], 422);
        }
        [$width, $height] = $info;

        if ($width !== $height) {
            return response()->json([
                'error' => 'aspect_ratio_must_be_1_1',
                'width' => $width,
                'height' => $height,
            ], 422);
        }

        if ($width < self::MIN_SIZE || $width > self::MAX_SIZE) {
            return response()->json([
                'error' => 'size_out_of_range',
                'min' => self::MIN_SIZE,
                'max' => self::MAX_SIZE,
                'actual' => $width,
            ], 422);
        }

        $uuid = (string) Str::uuid();
        $filename = $uuid . '.png';
        $relativePath = self::SUBDIR . '/' . $filename;
        // 上传前先取文件大小（move 后 UploadedFile 已失效）
        $bytes = @filesize($file->getRealPath()) ?: null;

        // 走统一存储服务（local 或 cos）。runner 需要绝对 URL 来 curl 下载
        $iconUrl = StorageService::uploadAbsolute($file, self::SUBDIR, $filename);
        if ($iconUrl === null) {
            return response()->json(['error' => 'storage_unavailable'], 500);
        }

        return response()->json([
            'icon_url' => $iconUrl,
            'relative_path' => $relativePath,
            'width' => $width,
            'height' => $height,
            'bytes' => $bytes,
        ], 200);
    }

    public function uploadCustomerServiceImage(Request $request): JsonResponse
    {
        return $this->uploadSettingImage($request, self::CUSTOMER_SERVICE_SUBDIR);
    }

    /**
     * 登录页背景图上传（admin-only）。
     * 与客服图片同款（PNG/JPEG/WebP，<= 5 MB），但不限宽高比——背景图本就是宽幅大图。
     * 存 public/cloud-build/login-bg/{uuid}.{ext}，返回绝对 URL 供桌面端登录页 cover 背景。
     */
    public function uploadLoginBackground(Request $request): JsonResponse
    {
        return $this->uploadSettingImage($request, self::LOGIN_BG_SUBDIR);
    }

    /**
     * 智能体列表页背景图上传（admin-only）。
     * 约束与登录页背景一致；存 public/cloud-build/bot-list-bg/{uuid}.{ext}，
     * 返回绝对 URL 供桌面端「智能体」页（首页）整页 cover 背景。
     */
    public function uploadBotListBackground(Request $request): JsonResponse
    {
        return $this->uploadSettingImage($request, self::BOT_LIST_BG_SUBDIR);
    }

    /**
     * 站点设置类图片通用上传：PNG/JPEG/WebP、<= 5 MB、不限宽高比。
     * 存 public/{subdir}/{uuid}.{ext}，返回绝对 URL（local 或 COS 由 StorageService 统一处理）。
     */
    private function uploadSettingImage(Request $request, string $subdir): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'image' => [
                'required',
                'file',
                'mimetypes:image/png,image/jpeg,image/webp',
                'mimes:png,jpg,jpeg,webp',
                'max:' . (int) (self::CUSTOMER_SERVICE_MAX_BYTES / 1024),
            ],
        ]);
        if ($validator->fails()) {
            return response()->json([
                'error' => 'validation_failed',
                'details' => $validator->errors(),
            ], 422);
        }

        $file = $request->file('image');
        $info = @getimagesize($file->getRealPath());
        if (!$info || !in_array(($info[2] ?? null), [IMAGETYPE_PNG, IMAGETYPE_JPEG, IMAGETYPE_WEBP], true)) {
            return response()->json(['error' => 'invalid_image'], 422);
        }

        $extension = strtolower((string) $file->getClientOriginalExtension());
        if (!in_array($extension, ['png', 'jpg', 'jpeg', 'webp'], true)) {
            $extension = match ($info[2]) {
                IMAGETYPE_JPEG => 'jpg',
                IMAGETYPE_WEBP => 'webp',
                default => 'png',
            };
        }

        $filename = (string) Str::uuid() . '.' . $extension;
        $relativePath = $subdir . '/' . $filename;
        $bytes = @filesize($file->getRealPath()) ?: null;

        $imageUrl = StorageService::uploadAbsolute($file, $subdir, $filename);
        if ($imageUrl === null) {
            return response()->json(['error' => 'storage_unavailable'], 500);
        }

        return response()->json([
            'image_url' => $imageUrl,
            'relative_path' => $relativePath,
            'width' => $info[0],
            'height' => $info[1],
            'bytes' => $bytes,
        ], 200);
    }
}
