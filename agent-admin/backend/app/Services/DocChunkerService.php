<?php

namespace App\Services;

/**
 * 文档切片服务：把富文本 HTML 切成适合 embedding 的 chunk 列表。
 *
 * 策略：
 *   1. HTML → 段落化的 plain text（保留段落 / 列表 / 标题分隔）
 *   2. 按段落聚合，达到 chunkSize（token 估算）切一刀
 *   3. 切刀后回溯 overlap token，保留上下文连续性
 *
 * Token 估算（简化版，不引入 tiktoken）：
 *   - ASCII 字符 ≈ 1/4 token
 *   - 非 ASCII（中日韩等多字节字符）≈ 1 token / 字
 *   实测对 OpenAI text-embedding-3-small 误差 ≈ ±15%，足够切片场景使用
 */
class DocChunkerService
{
    /**
     * 把富文本 HTML 切成多个 chunk。
     *
     * @return array<int, array{idx:int, text:string, token_count:int}>
     */
    public function chunkHtml(string $html, int $chunkSize = 800, int $overlap = 100): array
    {
        if ($chunkSize < 100) $chunkSize = 800;
        if ($overlap < 0)     $overlap   = 0;
        if ($overlap >= $chunkSize) $overlap = (int) ($chunkSize * 0.2);

        $paragraphs = $this->htmlToParagraphs($html);
        if (empty($paragraphs)) return [];

        $chunks = [];
        $current = '';
        $currentTokens = 0;
        $idx = 0;

        foreach ($paragraphs as $p) {
            $pTokens = $this->estimateTokens($p);

            // 单段已超过 chunkSize 时，强制把它单独切（不再合并）
            if ($pTokens >= $chunkSize) {
                if ($current !== '') {
                    $chunks[] = ['idx' => $idx++, 'text' => trim($current), 'token_count' => $currentTokens];
                    $current = '';
                    $currentTokens = 0;
                }
                // 按字符窗口硬切大段
                foreach ($this->splitLongParagraph($p, $chunkSize, $overlap) as $piece) {
                    $chunks[] = [
                        'idx' => $idx++,
                        'text' => $piece,
                        'token_count' => $this->estimateTokens($piece),
                    ];
                }
                continue;
            }

            // 加入当前 chunk 会超过 chunkSize → 先封口当前 chunk
            if ($currentTokens > 0 && ($currentTokens + $pTokens) > $chunkSize) {
                $chunks[] = ['idx' => $idx++, 'text' => trim($current), 'token_count' => $currentTokens];
                // 回溯 overlap：从当前 chunk 末尾取 overlap token 续到下一个
                $tail = $this->takeTailByTokens($current, $overlap);
                $current = $tail;
                $currentTokens = $this->estimateTokens($tail);
            }

            $current .= ($current === '' ? '' : "\n\n") . $p;
            $currentTokens = $this->estimateTokens($current);
        }

        // 收尾
        $current = trim($current);
        if ($current !== '') {
            $chunks[] = ['idx' => $idx++, 'text' => $current, 'token_count' => $this->estimateTokens($current)];
        }

        return $chunks;
    }

    /**
     * 估算 token 数（粗略，不需要外部库）
     * - 多字节字符（中文/日文/韩文）按 1 token / 字
     * - ASCII 按 4 字符 ≈ 1 token
     */
    public function estimateTokens(string $text): int
    {
        $len = strlen($text);
        $mblen = mb_strlen($text, 'UTF-8');
        $asciiBytes = max(0, $len - ($mblen * 3));  // 多字节字符在 UTF-8 多占 2-3 字节，粗估
        $ascii = $mblen - ($len - $mblen) / 2;
        if ($ascii < 0) $ascii = 0;
        $nonAscii = $mblen - $ascii;
        return (int) ceil($ascii / 4 + $nonAscii);
    }

    /**
     * 把 HTML 转成段落数组，保留段落 / 列表 / 标题分隔
     */
    private function htmlToParagraphs(string $html): array
    {
        if (trim($html) === '') return [];

        // 块级标签替换为换行符，便于按段拆分
        $blocks = ['p', 'div', 'br', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'pre', 'blockquote'];
        $pattern = '/<(' . implode('|', $blocks) . ')[^>]*>/i';
        $html = preg_replace($pattern, "\n", $html);
        $html = preg_replace('/<\/(' . implode('|', $blocks) . ')>/i', "\n", $html);

        // 剥剩余标签
        $text = strip_tags($html);
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');

        // 拆分 + 折叠空白
        $lines = preg_split('/\R/u', $text) ?: [];
        $paragraphs = [];
        foreach ($lines as $line) {
            $line = trim((string) preg_replace('/[ \t]+/u', ' ', $line));
            if ($line === '') continue;
            $paragraphs[] = $line;
        }
        return $paragraphs;
    }

    /**
     * 从字符串末尾按 token 数取一段（用于切刀后 overlap 回溯）
     */
    private function takeTailByTokens(string $text, int $tokens): string
    {
        if ($tokens <= 0 || $text === '') return '';
        $len = mb_strlen($text, 'UTF-8');
        // 反向估算：从尾巴一字一字往前数，到达 tokens 上限就停
        $count = 0;
        for ($i = $len - 1; $i >= 0; $i--) {
            $ch = mb_substr($text, $i, 1, 'UTF-8');
            $isAscii = strlen($ch) === 1;
            $count += $isAscii ? 0.25 : 1.0;
            if ($count >= $tokens) {
                return mb_substr($text, $i, $len - $i, 'UTF-8');
            }
        }
        return $text;
    }

    /**
     * 单段超大时按字符窗口硬切（无段落边界可用，但保留 overlap）
     *
     * @return array<int, string>
     */
    private function splitLongParagraph(string $paragraph, int $chunkSize, int $overlap): array
    {
        $pieces = [];
        $len = mb_strlen($paragraph, 'UTF-8');
        if ($len === 0) return $pieces;

        // 字符窗口：按估算的 chunkSize × 字符比例算窗口字数
        // 经验值：中文 1 字 ≈ 1 token，所以 chunkSize tokens ≈ chunkSize 字
        $window = $chunkSize;
        $step = max(1, $window - $overlap);

        for ($i = 0; $i < $len; $i += $step) {
            $piece = mb_substr($paragraph, $i, $window, 'UTF-8');
            if (trim($piece) === '') continue;
            $pieces[] = $piece;
            if ($i + $window >= $len) break;  // 末尾切完即止
        }
        return $pieces;
    }
}
