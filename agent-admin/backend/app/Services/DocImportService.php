<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use League\CommonMark\CommonMarkConverter;
use PhpOffice\PhpWord\IOFactory;

/**
 * 文档导入服务：把 md / docx 文件解析为可入库的标题 + HTML 富文本。
 *
 * 设计取舍：
 * - .doc 老二进制格式 phpword 支持差且常解析失败，统一拒绝并提示用户另存为 .docx
 * - 所有图片（docx 内嵌 base64 + Markdown 远程 url）都下载并转存到 StorageService，
 *   保证文档在内容源失效后仍可正常显示
 * - 远程图片下载有 5MB 上限 + 15s 超时，失败时保留原 src 不阻断主流程
 * - 解析失败抛 \RuntimeException，由 Controller 统一捕获返回 422
 */
class DocImportService
{
    /** 嵌入图片存储子目录 */
    private const SUBDIR = 'docs/embeds';
    /** 单张图片下载上限：5MB */
    private const MAX_IMG_BYTES = 5 * 1024 * 1024;
    /** 远程图片下载超时（秒） */
    private const HTTP_TIMEOUT = 15;

    /**
     * 解析上传文件，返回标题 + HTML 富文本 + 导入来源标签。
     *
     * @return array{title:string, subtitle:?string, content_html:string, import_source:string}
     * @throws \RuntimeException 不支持的格式 / 解析失败
     */
    public function parse(UploadedFile $file): array
    {
        $ext = strtolower($file->getClientOriginalExtension() ?: $file->extension() ?: '');
        $basename = pathinfo($file->getClientOriginalName(), PATHINFO_FILENAME);
        $basename = trim((string) $basename) ?: '未命名文档';

        if ($ext === 'md' || $ext === 'markdown') {
            return $this->parseMarkdown($file, $basename);
        }
        if ($ext === 'docx') {
            return $this->parseDocx($file, $basename);
        }
        if ($ext === 'doc') {
            throw new \RuntimeException('.doc 老二进制格式暂不支持，请先用 Word/WPS 打开后「另存为 .docx」再上传');
        }
        throw new \RuntimeException("不支持的文件格式：.{$ext}（仅支持 .md / .docx）");
    }

    /**
     * 把单张图片字节流落到 StorageService，返回访问 URL（local 相对路径 / cos 完整 URL）。
     * 失败返回 null，调用方决定是否回退到原 src。
     */
    public function storeImageBytes(string $bytes, string $ext): ?string
    {
        $ext = strtolower($ext);
        if (!in_array($ext, ['png', 'jpg', 'jpeg', 'webp', 'gif'], true)) {
            $ext = 'png';
        }

        // 写到 sys 临时目录后包装成 UploadedFile（test 模式：跳过 is_uploaded_file 检查）
        $tmp = sys_get_temp_dir() . DIRECTORY_SEPARATOR . Str::uuid()->toString() . '.' . $ext;
        if (file_put_contents($tmp, $bytes) === false) {
            return null;
        }

        try {
            $uploaded = new UploadedFile(
                $tmp,
                'embed.' . $ext,
                $this->extToMime($ext),
                null,
                true
            );
            $filename = Str::uuid()->toString() . '.' . $ext;
            $url = StorageService::upload($uploaded, self::SUBDIR, $filename);
            return $url ?: null;
        } finally {
            // StorageService::upload 内部会 move 文件，但失败路径可能残留；统一清理
            if (is_file($tmp)) {
                @unlink($tmp);
            }
        }
    }

    // ===== Markdown =====

    private function parseMarkdown(UploadedFile $file, string $basename): array
    {
        $raw = @file_get_contents($file->getRealPath());
        if ($raw === false) {
            throw new \RuntimeException('读取 Markdown 文件失败');
        }
        // 去 BOM
        $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw);

        // 提取首个 # 标题（commonmark 渲染后再剥也行，但渲染前提取避免还要剥 HTML）
        $title = $basename;
        if (preg_match('/^\s*#\s+(.+?)\s*$/m', $raw, $m)) {
            $title = trim($m[1]);
            // 从原文里去掉这一行
            $raw = preg_replace('/^\s*#\s+.+?$\R?/m', '', $raw, 1);
        }

        $converter = new CommonMarkConverter([
            'html_input' => 'strip',
            'allow_unsafe_links' => false,
        ]);
        $html = (string) $converter->convert($raw)->getContent();

        // 下载远程图片转存到本地存储
        $html = $this->rewriteRemoteImages($html);

        return [
            'title'         => $this->normalizeTitle($title, $basename),
            'subtitle'      => null,
            'content_html'  => trim($html),
            'import_source' => 'md',
        ];
    }

    // ===== docx =====

    private function parseDocx(UploadedFile $file, string $basename): array
    {
        try {
            $phpWord = IOFactory::load($file->getRealPath(), 'Word2007');
        } catch (\Throwable $e) {
            throw new \RuntimeException('docx 解析失败：' . $e->getMessage());
        }

        // 用 HtmlWriter 输出 HTML 串。PhpWord 默认会把图片以 base64 data URI 嵌入 <img>
        try {
            $writer = IOFactory::createWriter($phpWord, 'HTML');
            ob_start();
            $writer->save('php://output');
            $fullHtml = (string) ob_get_clean();
        } catch (\Throwable $e) {
            if (ob_get_level() > 0) ob_end_clean();
            throw new \RuntimeException('docx 转 HTML 失败：' . $e->getMessage());
        }

        // 仅截取 <body> 内的内容
        $html = $fullHtml;
        if (preg_match('/<body[^>]*>(.*?)<\/body>/si', $fullHtml, $m)) {
            $html = $m[1];
        }
        // 剥 style/script/meta/title（HtmlWriter 输出会含 <style> 块）
        $html = preg_replace('/<style[^>]*>.*?<\/style>/si', '', $html);
        $html = preg_replace('/<script[^>]*>.*?<\/script>/si', '', $html);
        $html = preg_replace('/<meta[^>]*>/i', '', $html);
        $html = preg_replace('/<title[^>]*>.*?<\/title>/si', '', $html);

        // 提取首个 H1 / Heading1 作为标题
        $title = $basename;
        if (preg_match('/<h1[^>]*>(.*?)<\/h1>/si', $html, $m)) {
            $title = trim((string) strip_tags($m[1]));
            $html = preg_replace('/<h1[^>]*>.*?<\/h1>/si', '', $html, 1);
        } elseif (preg_match('/<p[^>]*class="[^"]*Heading1[^"]*"[^>]*>(.*?)<\/p>/si', $html, $m)) {
            $title = trim((string) strip_tags($m[1]));
            $html = preg_replace('/<p[^>]*class="[^"]*Heading1[^"]*"[^>]*>.*?<\/p>/si', '', $html, 1);
        }

        // 1) 内嵌 base64 图片转存到 StorageService
        $html = $this->rewriteBase64Images($html);
        // 2) 万一文档里有远程图片链接，也下载转存
        $html = $this->rewriteRemoteImages($html);

        return [
            'title'         => $this->normalizeTitle($title, $basename),
            'subtitle'      => null,
            'content_html'  => trim($html),
            'import_source' => 'docx',
        ];
    }

    // ===== 图片处理 =====

    /**
     * 把 <img src="data:image/...;base64,..."> 的 base64 数据转存到 StorageService，
     * 把 src 替换成本站访问 URL。转存失败的保留原 src（避免阻断导入）。
     */
    private function rewriteBase64Images(string $html): string
    {
        return (string) preg_replace_callback(
            '/<img([^>]*?)\s+src=(["\'])(data:image\/([a-z]+);base64,([^"\']+))\2([^>]*)>/i',
            function ($m) {
                $ext = strtolower($m[4]);
                $bytes = base64_decode($m[5], true);
                if ($bytes === false || strlen($bytes) > self::MAX_IMG_BYTES) {
                    return $m[0];
                }
                $url = $this->storeImageBytes($bytes, $ext);
                if (!$url) return $m[0];
                return '<img' . $m[1] . ' src=' . $m[2] . $url . $m[2] . $m[6] . '>';
            },
            $html
        );
    }

    /**
     * 把 <img src="https://..."> 的远程图下载转存。失败保留原 src。
     */
    private function rewriteRemoteImages(string $html): string
    {
        return (string) preg_replace_callback(
            '/<img([^>]*?)\s+src=(["\'])(https?:\/\/[^"\']+)\2([^>]*)>/i',
            function ($m) {
                $url = $this->downloadAndStore($m[3]);
                if (!$url) return $m[0];
                return '<img' . $m[1] . ' src=' . $m[2] . $url . $m[2] . $m[4] . '>';
            },
            $html
        );
    }

    /**
     * 下载远程图片到 StorageService，返回新 URL（失败 null）。
     */
    private function downloadAndStore(string $url): ?string
    {
        try {
            $resp = Http::timeout(self::HTTP_TIMEOUT)
                ->withOptions(['allow_redirects' => true])
                ->get($url);
            if (!$resp->successful()) return null;

            $bytes = $resp->body();
            if (strlen($bytes) === 0 || strlen($bytes) > self::MAX_IMG_BYTES) return null;

            // 扩展名：优先 Content-Type，否则从 URL 路径推断
            $ct = strtolower((string) $resp->header('Content-Type'));
            $ext = match (true) {
                str_contains($ct, 'jpeg'),
                str_contains($ct, 'jpg')   => 'jpg',
                str_contains($ct, 'png')   => 'png',
                str_contains($ct, 'webp')  => 'webp',
                str_contains($ct, 'gif')   => 'gif',
                default => $this->guessExtFromUrl($url),
            };

            return $this->storeImageBytes($bytes, $ext);
        } catch (\Throwable $e) {
            Log::warning('[DocImport] download remote image failed', [
                'url' => $url,
                'err' => $e->getMessage(),
            ]);
            return null;
        }
    }

    private function guessExtFromUrl(string $url): string
    {
        $path = (string) parse_url($url, PHP_URL_PATH);
        $ext = strtolower((string) pathinfo($path, PATHINFO_EXTENSION));
        return match ($ext) {
            'jpg', 'jpeg' => 'jpg',
            'png', 'webp', 'gif' => $ext,
            default => 'png',
        };
    }

    private function extToMime(string $ext): string
    {
        return match ($ext) {
            'jpg', 'jpeg' => 'image/jpeg',
            'png'  => 'image/png',
            'webp' => 'image/webp',
            'gif'  => 'image/gif',
            default => 'application/octet-stream',
        };
    }

    /**
     * 标题清洗：剥剩余标签 / 折叠空白 / 截断到 200 字 / 空时回退文件名
     */
    private function normalizeTitle(string $title, string $fallback): string
    {
        $title = (string) strip_tags($title);
        $title = trim((string) preg_replace('/\s+/u', ' ', $title));
        if ($title === '') $title = $fallback;
        if (mb_strlen($title, 'UTF-8') > 200) {
            $title = mb_substr($title, 0, 200, 'UTF-8');
        }
        return $title;
    }
}
