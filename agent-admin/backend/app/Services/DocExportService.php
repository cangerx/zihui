<?php

namespace App\Services;

use App\Models\Doc;
use DOMDocument;
use DOMNode;
use DOMText;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;

/**
 * 文档导出服务：把 Doc 的 content_html 转成 Markdown 文本，并把图片 src 改成绝对 URL。
 *
 * 设计取舍：
 * - 不引第三方库（league/html-to-markdown 会拉一坨 commonmark 子树）；自己写最小遍历，
 *   只覆盖 DocRichEditor（受控编辑器）实际输出的标签集合：h1-h6 / p / a / img / ul / ol /
 *   li / strong / em / code / pre / blockquote / br / hr / table（简化处理）。
 * - 图片 src 用绝对 URL：本地存储相对路径 → 拼 APP_URL；本身就是 http(s):// 的保持不动。
 *   导出 zip 包不内嵌图片文件，用户离线打开 .md 时图片仍可在线加载，避免 zip 膨胀。
 * - 标题前后留空行，列表 / 段落 / 表格之间留空行，符合 Markdown 主流渲染器的预期。
 */
class DocExportService
{
    /**
     * 把单个 Doc 转成完整 Markdown 文档（含 H1 标题 + 副标题）。
     */
    public function exportDoc(Doc $doc): string
    {
        $lines = [];
        // 顶级 H1 用文档标题
        $lines[] = '# ' . $doc->title;
        $lines[] = '';
        if (!empty($doc->subtitle)) {
            $lines[] = '> ' . $doc->subtitle;
            $lines[] = '';
        }
        $body = $this->htmlToMarkdown((string) $doc->content_html);
        if ($body !== '') {
            $lines[] = $body;
        }
        // 末尾确保单个换行
        return rtrim(implode("\n", $lines)) . "\n";
    }

    /**
     * 给定 doc 计算导出文件名（不含扩展名）。
     * 优先用 slug，无 slug 用 title 转 ascii；最终都 fallback 到 doc-{id}。
     */
    public function buildBaseName(Doc $doc): string
    {
        $base = '';
        if (!empty($doc->slug)) {
            $base = (string) $doc->slug;
        }
        if ($base === '') {
            // Str::slug 对中文会返回空串；中文 title 直接用 doc-{id} fallback
            $slugged = Str::slug((string) $doc->title);
            if ($slugged !== '') {
                $base = $slugged;
            }
        }
        if ($base === '') {
            $base = 'doc-' . $doc->id;
        }
        // 进一步清洗：去掉 zip 不允许的字符
        $base = preg_replace('#[/\\\\:*?"<>|]+#', '-', $base) ?? $base;
        $base = trim($base, '.- ');
        return $base !== '' ? $base : 'doc-' . $doc->id;
    }

    // ---------------------------------------------------------------------
    // HTML → Markdown
    // ---------------------------------------------------------------------

    private function htmlToMarkdown(string $html): string
    {
        $html = trim($html);
        if ($html === '') return '';

        $doc = new DOMDocument();
        $prev = libxml_use_internal_errors(true);
        // 用 utf-8 meta 防止 loadHTML 把中文当 ISO-8859-1 解析变乱码
        $wrapped = '<?xml encoding="utf-8"?><div>' . $html . '</div>';
        $doc->loadHTML($wrapped, LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD);
        libxml_clear_errors();
        libxml_use_internal_errors($prev);

        $root = $doc->getElementsByTagName('div')->item(0);
        if (!$root) return '';

        $out = '';
        foreach ($root->childNodes as $child) {
            $out .= $this->renderBlock($child);
        }
        // 折叠 3+ 连续空行为 2 个
        $out = preg_replace("/\n{3,}/", "\n\n", $out) ?? $out;
        return trim($out);
    }

    /**
     * 块级节点渲染：每个块尾部留双换行。
     */
    private function renderBlock(DOMNode $node): string
    {
        if ($node instanceof DOMText) {
            $text = trim($node->nodeValue ?? '');
            return $text === '' ? '' : $text . "\n\n";
        }

        $tag = strtolower($node->nodeName);
        $inner = $this->renderInline($node);

        switch ($tag) {
            case 'h1': return "# {$inner}\n\n";
            case 'h2': return "## {$inner}\n\n";
            case 'h3': return "### {$inner}\n\n";
            case 'h4': return "#### {$inner}\n\n";
            case 'h5': return "##### {$inner}\n\n";
            case 'h6': return "###### {$inner}\n\n";

            case 'p':
            case 'div':
            case 'section':
            case 'article':
                // 子节点里可能再嵌套块（如 figure>img），交给递归
                if ($this->hasBlockChild($node)) {
                    $buf = '';
                    foreach ($node->childNodes as $c) {
                        $buf .= $this->renderBlock($c);
                    }
                    return $buf;
                }
                return $inner === '' ? '' : $inner . "\n\n";

            case 'ul': return $this->renderList($node, false) . "\n";
            case 'ol': return $this->renderList($node, true) . "\n";

            case 'blockquote':
                $quoted = trim($inner);
                if ($quoted === '') return '';
                // 引用块的每一行都加 '> ' 前缀
                $quoted = preg_replace('/^/m', '> ', $quoted) ?? $quoted;
                return $quoted . "\n\n";

            case 'pre':
                // <pre><code class="language-xx">...</code></pre> 或 <pre>...</pre>
                $code = '';
                $lang = '';
                $codeNode = null;
                foreach ($node->childNodes as $c) {
                    if (strtolower($c->nodeName) === 'code') {
                        $codeNode = $c;
                        break;
                    }
                }
                if ($codeNode) {
                    $code = $codeNode->textContent ?? '';
                    if ($codeNode instanceof \DOMElement) {
                        $cls = $codeNode->getAttribute('class');
                        if (preg_match('/language-([\w-]+)/', $cls, $m)) {
                            $lang = $m[1];
                        }
                    }
                } else {
                    $code = $node->textContent ?? '';
                }
                $code = rtrim((string) $code, "\n");
                return "```{$lang}\n{$code}\n```\n\n";

            case 'hr':
                return "---\n\n";

            case 'figure':
                // 通常 <figure><img>...<figcaption>...</figcaption></figure>
                $buf = '';
                foreach ($node->childNodes as $c) {
                    $buf .= $this->renderBlock($c);
                }
                return $buf;

            case 'figcaption':
                return $inner === '' ? '' : "*{$inner}*\n\n";

            case 'img':
                return $this->renderImage($node) . "\n\n";

            case 'table':
                return $this->renderTable($node) . "\n\n";

            default:
                // 未知 / 未列出的标签：内联渲染兜底
                return $inner === '' ? '' : $inner . "\n\n";
        }
    }

    /**
     * 内联节点渲染：合并子节点文本 + 行内格式（不在结尾加额外换行）。
     */
    private function renderInline(DOMNode $node): string
    {
        if ($node instanceof DOMText) {
            return $node->nodeValue ?? '';
        }

        $tag = strtolower($node->nodeName);
        // 行内级标签
        switch ($tag) {
            case 'br':
                return "  \n";  // Markdown 软换行 = 行尾两空格

            case 'strong':
            case 'b':
                return '**' . $this->childrenInline($node) . '**';

            case 'em':
            case 'i':
                return '*' . $this->childrenInline($node) . '*';

            case 'code':
                // 块级 pre>code 已被 renderBlock 接管，这里只处理行内
                return '`' . $this->childrenInline($node) . '`';

            case 'a':
                $href = $node instanceof \DOMElement ? $node->getAttribute('href') : '';
                $txt  = $this->childrenInline($node);
                if ($txt === '') $txt = $href;
                if ($href === '') return $txt;
                return "[{$txt}]({$href})";

            case 'img':
                return $this->renderImage($node);

            case 'del':
            case 's':
            case 'strike':
                return '~~' . $this->childrenInline($node) . '~~';

            default:
                // 未知行内标签：递归取子节点文本
                return $this->childrenInline($node);
        }
    }

    private function childrenInline(DOMNode $node): string
    {
        $out = '';
        foreach ($node->childNodes as $c) {
            $out .= $this->renderInline($c);
        }
        return $out;
    }

    private function renderList(DOMNode $node, bool $ordered): string
    {
        $i = 1;
        $lines = [];
        foreach ($node->childNodes as $li) {
            if (strtolower($li->nodeName) !== 'li') continue;
            $prefix = $ordered ? ($i . '. ') : '- ';
            // li 内的内联内容
            $inner = trim($this->childrenInline($li));
            // 多行内容缩进
            $inner = preg_replace("/\n/", "\n  ", $inner) ?? $inner;
            $lines[] = $prefix . $inner;
            $i++;
        }
        return implode("\n", $lines);
    }

    private function renderImage(DOMNode $node): string
    {
        if (!($node instanceof \DOMElement)) return '';
        $src = trim($node->getAttribute('src'));
        $alt = trim($node->getAttribute('alt'));
        if ($src === '') return '';
        $src = $this->absoluteUrl($src);
        return "![{$alt}]({$src})";
    }

    /**
     * 极简表格转换：每个 tr 转 | 分隔的一行；首行 tr 后补分隔行。
     * 不处理 colspan / rowspan（Markdown 表格不支持）。
     */
    private function renderTable(DOMNode $node): string
    {
        $rows = [];
        // 直接 DOM 递归收集所有 tr（兼容 <thead>/<tbody> 嵌套）
        $allTr = [];
        $this->collectTags($node, 'tr', $allTr);
        foreach ($allTr as $tr) {
            $cells = [];
            foreach ($tr->childNodes as $cell) {
                $tag = strtolower($cell->nodeName);
                if ($tag !== 'td' && $tag !== 'th') continue;
                $cells[] = trim($this->childrenInline($cell));
            }
            if ($cells === []) continue;
            $rows[] = '| ' . implode(' | ', $cells) . ' |';
        }
        if ($rows === []) return '';
        // 表头分隔（如果首行是 th 就当表头；否则也按表头处理，提升兼容性）
        $colCount = substr_count($rows[0], '|') - 1;
        $sep = '|' . str_repeat(' --- |', max(1, $colCount));
        array_splice($rows, 1, 0, [$sep]);
        return implode("\n", $rows);
    }

    /**
     * 递归收集指定标签节点。
     *
     * @param array<int,\DOMElement> $out
     */
    private function collectTags(DOMNode $node, string $tag, array &$out): void
    {
        foreach ($node->childNodes as $c) {
            if ($c instanceof \DOMElement && strtolower($c->nodeName) === $tag) {
                $out[] = $c;
            }
            if ($c->hasChildNodes()) {
                $this->collectTags($c, $tag, $out);
            }
        }
    }

    private function hasBlockChild(DOMNode $node): bool
    {
        static $block = ['p','div','section','article','h1','h2','h3','h4','h5','h6',
            'ul','ol','blockquote','pre','figure','table','hr'];
        foreach ($node->childNodes as $c) {
            if ($c instanceof \DOMElement && in_array(strtolower($c->nodeName), $block, true)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 把可能的相对路径图片 src 转成绝对 URL。
     *  - 已带 scheme（http/https/data:）：原样返回
     *  - /xxx 开头：URL::to() 拼 APP_URL
     *  - 其他：当 / 开头处理
     */
    private function absoluteUrl(string $src): string
    {
        if ($src === '') return '';
        if (preg_match('#^(https?:)?//#i', $src) || str_starts_with($src, 'data:')) {
            return $src;
        }
        if ($src[0] !== '/') {
            $src = '/' . ltrim($src, '/');
        }
        return URL::to($src);
    }
}
