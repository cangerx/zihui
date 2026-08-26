<?php

namespace App\Services\Knowledge;

use App\Services\DocImportService;
use Illuminate\Http\UploadedFile;
use Smalot\PdfParser\Parser as PdfParser;

/**
 * 知识库上传文件解析：统一把多种格式解析为 content_html。
 *
 * 复用策略：
 * - md / markdown / docx → 委托 DocImportService（含图片转存逻辑，与文档中心一致）
 * - pdf  → smalot/pdfparser 抽取文本
 * - xlsx → PHP 内置 ZipArchive + SimpleXML 抽取（不依赖 phpspreadsheet，规避 PHP8.0 依赖冲突）
 * - csv  → 原生 fgetcsv
 * - txt  → 原生读取（自动 GBK→UTF-8）
 * .doc / .xls 老二进制格式拒绝，提示另存。
 */
class KbDocumentParseService
{
    /** 支持的上传扩展名 */
    private const SUPPORTED = ['md', 'markdown', 'docx', 'pdf', 'txt', 'text', 'csv', 'xlsx'];
    /** 单文档抽取文本上限（字符），防止超大文件拖垮向量化 */
    private const MAX_TEXT_CHARS = 500000;

    public function supportedExtensions(): array
    {
        return self::SUPPORTED;
    }

    /**
     * 解析上传文件。
     *
     * @return array{title:string, content_html:string, source_type:string, original_filename:string}
     * @throws \RuntimeException 不支持的格式 / 解析失败
     */
    public function parse(UploadedFile $file): array
    {
        $ext = strtolower($file->getClientOriginalExtension() ?: $file->extension() ?: '');
        $basename = trim((string) pathinfo($file->getClientOriginalName(), PATHINFO_FILENAME)) ?: '未命名文档';
        $original = (string) $file->getClientOriginalName();

        if (in_array($ext, ['md', 'markdown', 'docx'], true)) {
            $r = app(DocImportService::class)->parse($file);
            return [
                'title' => (string) ($r['title'] ?? $basename),
                'content_html' => (string) ($r['content_html'] ?? ''),
                'source_type' => 'upload',
                'original_filename' => $original,
            ];
        }
        if ($ext === 'pdf') {
            return $this->wrap($this->parsePdf($file), $basename, $original);
        }
        if ($ext === 'txt' || $ext === 'text') {
            return $this->wrap($this->parseTxt($file), $basename, $original);
        }
        if ($ext === 'csv') {
            return $this->wrap($this->parseCsv($file), $basename, $original);
        }
        if ($ext === 'xlsx') {
            return $this->wrap($this->parseXlsx($file), $basename, $original);
        }
        if ($ext === 'doc') {
            throw new \RuntimeException('.doc 老二进制格式暂不支持，请用 Word/WPS 另存为 .docx 或 .pdf 再上传');
        }
        if ($ext === 'xls') {
            throw new \RuntimeException('.xls 老二进制格式暂不支持，请另存为 .xlsx 或 .csv 再上传');
        }
        throw new \RuntimeException("不支持的文件格式：.{$ext}（支持 md/markdown/docx/pdf/txt/csv/xlsx）");
    }

    private function wrap(string $html, string $basename, string $original): array
    {
        return [
            'title' => $basename,
            'content_html' => $html,
            'source_type' => 'upload',
            'original_filename' => $original,
        ];
    }

    private function parsePdf(UploadedFile $file): string
    {
        try {
            $parser = new PdfParser();
            $pdf = $parser->parseFile($file->getRealPath());
            $text = (string) $pdf->getText();
        } catch (\Throwable $e) {
            throw new \RuntimeException('PDF 解析失败：' . $e->getMessage());
        }
        $text = $this->truncate($text);
        if (trim($text) === '') {
            throw new \RuntimeException('PDF 未提取到文本（可能是扫描件 / 图片型 PDF，暂不支持 OCR）');
        }
        return $this->textToHtml($text);
    }

    private function parseTxt(UploadedFile $file): string
    {
        $raw = @file_get_contents($file->getRealPath());
        if ($raw === false) {
            throw new \RuntimeException('读取文本文件失败');
        }
        $raw = (string) preg_replace('/^\xEF\xBB\xBF/', '', $raw);
        $raw = $this->toUtf8($raw);
        $text = $this->truncate($raw);
        if (trim($text) === '') {
            throw new \RuntimeException('文本文件为空');
        }
        return $this->textToHtml($text);
    }

    private function parseCsv(UploadedFile $file): string
    {
        $fh = @fopen($file->getRealPath(), 'r');
        if ($fh === false) {
            throw new \RuntimeException('读取 CSV 失败');
        }
        $rows = [];
        $charCount = 0;
        try {
            while (($row = fgetcsv($fh)) !== false) {
                $line = implode("\t", array_map(fn ($c) => (string) $c, $row));
                $charCount += strlen($line);
                if ($charCount > self::MAX_TEXT_CHARS) {
                    break;
                }
                if (trim($line) !== '') {
                    $rows[] = $line;
                }
            }
        } finally {
            fclose($fh);
        }
        $text = $this->toUtf8(implode("\n", $rows));
        if (trim($text) === '') {
            throw new \RuntimeException('CSV 内容为空');
        }
        return $this->textToHtml($text);
    }

    private function parseXlsx(UploadedFile $file): string
    {
        if (!class_exists(\ZipArchive::class)) {
            throw new \RuntimeException('服务器未启用 ZipArchive 扩展，无法解析 xlsx');
        }
        $zip = new \ZipArchive();
        if ($zip->open($file->getRealPath()) !== true) {
            throw new \RuntimeException('xlsx 打开失败（非有效的 Excel 文件）');
        }

        $lines = [];
        try {
            $shared = [];
            $ssXml = $zip->getFromName('xl/sharedStrings.xml');
            if (is_string($ssXml) && $ssXml !== '') {
                $sx = @simplexml_load_string($ssXml);
                if ($sx !== false) {
                    foreach ($sx->si as $si) {
                        $shared[] = $this->xlsxSiText($si);
                    }
                }
            }

            for ($i = 1; ; $i++) {
                $sheetXml = $zip->getFromName("xl/worksheets/sheet{$i}.xml");
                if ($sheetXml === false) {
                    break;
                }
                $sx = @simplexml_load_string($sheetXml);
                if ($sx === false || !isset($sx->sheetData)) {
                    continue;
                }
                foreach ($sx->sheetData->row as $row) {
                    $cells = [];
                    foreach ($row->c as $c) {
                        $cells[] = $this->xlsxCellText($c, $shared);
                    }
                    $line = trim(implode("\t", $cells));
                    if ($line !== '') {
                        $lines[] = $line;
                    }
                }
                if (strlen(implode("\n", $lines)) > self::MAX_TEXT_CHARS) {
                    break;
                }
            }
        } finally {
            $zip->close();
        }

        $text = $this->truncate(implode("\n", $lines));
        if (trim($text) === '') {
            throw new \RuntimeException('xlsx 未提取到文本');
        }
        return $this->textToHtml($text);
    }

    private function xlsxSiText(\SimpleXMLElement $si): string
    {
        if (isset($si->t)) {
            return (string) $si->t;
        }
        $buf = '';
        foreach ($si->r as $r) {
            $buf .= (string) $r->t;
        }
        return $buf;
    }

    private function xlsxCellText(\SimpleXMLElement $c, array $shared): string
    {
        $type = (string) ($c['t'] ?? '');
        if ($type === 's') {
            $idx = isset($c->v) ? (int) $c->v : -1;
            return $shared[$idx] ?? '';
        }
        if ($type === 'inlineStr') {
            return isset($c->is->t) ? (string) $c->is->t : '';
        }
        return isset($c->v) ? (string) $c->v : '';
    }

    /**
     * 纯文本转 HTML：按空行分段，escape 后包 <p>，保留换行。
     */
    private function textToHtml(string $text): string
    {
        $text = str_replace(["\r\n", "\r"], "\n", $text);
        $paras = preg_split('/\n{2,}/', $text) ?: [];
        if (count($paras) <= 1) {
            $paras = explode("\n", $text);
        }
        $html = '';
        foreach ($paras as $p) {
            $p = trim($p);
            if ($p === '') {
                continue;
            }
            $html .= '<p>' . nl2br(htmlspecialchars($p, ENT_QUOTES, 'UTF-8')) . "</p>\n";
        }
        return $html;
    }

    private function toUtf8(string $text): string
    {
        if ($text === '' || mb_check_encoding($text, 'UTF-8')) {
            return $text;
        }
        $converted = @mb_convert_encoding($text, 'UTF-8', 'GBK,GB2312,BIG5,UTF-8');
        return $converted !== false ? $converted : $text;
    }

    private function truncate(string $text): string
    {
        if (mb_strlen($text, 'UTF-8') > self::MAX_TEXT_CHARS) {
            return mb_substr($text, 0, self::MAX_TEXT_CHARS, 'UTF-8');
        }
        return $text;
    }
}
