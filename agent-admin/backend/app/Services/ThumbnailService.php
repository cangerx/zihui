<?php

namespace App\Services;

/**
 * 缩略图生成（GD）。
 *
 * 仅用于「存量数据回填命令」（thumbnails:backfill）。运行期的新上传由上传端（桌面 nativeImage /
 * 后台网页 canvas）生成缩略图，后端不依赖任何图像扩展；本服务是回填老数据时唯一用到 GD 的地方，
 * GD 缺失时返回 null，调用方据此跳过该条（不阻断）。
 */
class ThumbnailService
{
    public static function available(): bool
    {
        return \extension_loaded('gd') && \function_exists('imagecreatefromstring');
    }

    /**
     * 由原图字节生成 JPEG 缩略图字节。
     * 等比缩放到长边 <= $maxSide（只缩不放），透明通道铺白（JPEG 无 alpha）。
     *
     * @return string|null  成功返回 JPEG 字节；GD 不可用 / 解码失败 / 编码失败返回 null
     */
    public static function generateJpeg(string $bytes, int $maxSide = 720, int $quality = 82): ?string
    {
        if (!self::available() || $bytes === '') {
            return null;
        }

        $src = @imagecreatefromstring($bytes);
        if ($src === false) {
            return null;
        }

        $w = imagesx($src);
        $h = imagesy($src);
        if ($w < 1 || $h < 1) {
            imagedestroy($src);
            return null;
        }

        $scale = min(1.0, $maxSide / max($w, $h));
        $nw = max(1, (int) round($w * $scale));
        $nh = max(1, (int) round($h * $scale));

        $dst = imagecreatetruecolor($nw, $nh);
        // JPEG 不支持透明，先铺白底再贴图，避免 PNG/WEBP 透明区域变黑
        $white = imagecolorallocate($dst, 255, 255, 255);
        imagefilledrectangle($dst, 0, 0, $nw, $nh, $white);
        imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);

        ob_start();
        $ok = imagejpeg($dst, null, max(1, min(100, $quality)));
        $out = (string) ob_get_clean();

        imagedestroy($src);
        imagedestroy($dst);

        return ($ok && $out !== '') ? $out : null;
    }
}
