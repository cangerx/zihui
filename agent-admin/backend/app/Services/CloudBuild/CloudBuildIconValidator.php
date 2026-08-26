<?php

namespace App\Services\CloudBuild;

use App\Services\StorageService;
use Illuminate\Support\Facades\Http;

/**
 * 云打包图标统一校验：必须是真实 PNG、正方形、512×512–1024×1024、≤2MB。
 *
 * 背景：图标上传控件（CloudBuildIconController）有强校验，但 OEM 项目 / 打包请求里的
 * icon_url 允许「手动填写任意 URL」或「复用项目已存的 URL」，这条路径绕过了上传校验，
 * 非 PNG（如 JPEG logo）会一路传到 GitHub Actions 才在 inject-build-params.js 的
 * validatePng 处晦涩失败。本校验器在 OEM 项目保存 / 打包请求时同步把关，给出明确中文错误。
 *
 * 规则与 GitHub runner 的 inject-build-params.js validatePng 完全对齐。
 */
class CloudBuildIconValidator
{
    public const MIN_SIZE = 512;
    public const MAX_SIZE = 1024;
    public const MAX_BYTES = 2 * 1024 * 1024;

    /** 统一的中文规则文案（与前端 CLOUD_BUILD_ICON_RULE_TEXT 保持一致） */
    public const RULE_TEXT = '图标必须是 PNG 格式、1:1 正方形、尺寸 512×512 至 1024×1024、不超过 2MB';

    /**
     * 校验图标 URL 指向的内容是否合规。
     *
     * @return string|null null = 合规；否则返回面向用户的中文错误原因。
     */
    public static function validateUrl(?string $url): ?string
    {
        $url = trim((string) $url);
        if ($url === '') {
            return '图标地址为空';
        }
        $bytes = self::fetchBytes($url);
        if ($bytes === null || $bytes === '') {
            return '无法读取图标，请确认图标地址可正常访问（独立部署请检查 .env 的 APP_URL 是否为对外可访问的真实域名，并执行 php artisan config:clear）';
        }
        return self::validateBytes($bytes);
    }

    /**
     * 校验图标字节内容是否合规。
     *
     * @return string|null null = 合规；否则返回中文错误原因。
     */
    public static function validateBytes(string $bytes): ?string
    {
        if (strlen($bytes) > self::MAX_BYTES) {
            return '图标超过 2MB，请压缩后重试';
        }
        // PNG 魔数：89 50 4E 47 0D 0A 1A 0A
        if (strlen($bytes) < 24 || substr($bytes, 0, 8) !== "\x89PNG\r\n\x1a\n") {
            return '图标必须是 PNG 格式（当前文件不是 PNG，例如 JPG/WEBP 不被接受）';
        }
        $info = @getimagesizefromstring($bytes);
        if (!$info || ($info[2] ?? null) !== IMAGETYPE_PNG) {
            return '图标必须是 PNG 格式（当前文件不是有效 PNG）';
        }
        [$w, $h] = $info;
        if ((int) $w !== (int) $h) {
            return "图标必须是 1:1 正方形（当前为 {$w}×{$h}）";
        }
        if ($w < self::MIN_SIZE || $w > self::MAX_SIZE) {
            return "图标尺寸必须在 512×512 至 1024×1024 之间（当前为 {$w}×{$h}）";
        }
        return null;
    }

    /**
     * 读取图标字节。
     *
     * - 本站对象存储默认域名（*.myqcloud.com / *.aliyuncs.com）优先走签名读取，
     *   规避私有读 / 防盗链；
     * - 其余（自定义 CDN 域名、本站绝对 URL、外部 URL）走 HTTP 下载，跳过证书校验，
     *   兼容自定义 CDN 证书链不完整的情况（与 agent-build downloadIcon 的可达性一致）；
     * - 相对路径回退本地存储读取。
     */
    private static function fetchBytes(string $url): ?string
    {
        $driver = StorageService::detectDriverFromUrl($url);
        if ($driver === 'cos' || $driver === 'oss') {
            $bytes = StorageService::readBytes($url, $driver);
            if ($bytes !== null && $bytes !== '') {
                return $bytes;
            }
        }
        if (str_starts_with($url, 'http://') || str_starts_with($url, 'https://')) {
            try {
                $resp = Http::withoutVerifying()->timeout(20)->get($url);
                if ($resp->successful()) {
                    return (string) $resp->body();
                }
            } catch (\Throwable $e) {
                // 落到下面的本地兜底
            }
            // HTTP 取不到：独立部署常因 APP_URL 配错，使图标绝对 URL 外部/自连不可达。
            // local 存储下图标其实就在本机 public 目录，按 URL path 回退本地读取，
            // 让校验不再强依赖 APP_URL 是否正确（同时修复历史已存的错误绝对 URL）。
            if (StorageService::getStorageType() === 'local') {
                $bytes = StorageService::readBytes($url, 'local');
                if ($bytes !== null && $bytes !== '') {
                    return $bytes;
                }
            }
            return null;
        }
        $bytes = StorageService::readBytes($url, 'local');
        return ($bytes !== null && $bytes !== '') ? $bytes : null;
    }
}
