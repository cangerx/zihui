<?php

namespace App\Services\ReleaseDraft;

class ChangelogDraftParser
{
    /**
     * 从 Keep a Changelog 取出指定版本或 Unreleased 的条目。
     *
     * @return array{version: string, changelog: string, source: string}
     */
    public static function fromMarkdown(string $markdown, ?string $fallbackVersion = null): array
    {
        $unreleased = self::section($markdown, 'Unreleased');
        $unreleasedLines = self::bulletLines($unreleased);
        if ($unreleasedLines !== []) {
            return [
                'version' => $fallbackVersion ?: '0.0.0',
                'changelog' => implode("\n", $unreleasedLines),
                'source' => 'CHANGELOG Unreleased',
            ];
        }

        $version = $fallbackVersion ?: self::firstDatedVersion($markdown) ?: '0.0.0';
        $section = self::section($markdown, $version);
        $lines = self::bulletLines($section);
        $blurb = self::sectionBlurb($section);
        if ($blurb !== '' && $lines === []) {
            $lines = [$blurb];
        } elseif ($blurb !== '') {
            array_unshift($lines, $blurb);
        }

        return [
            'version' => $version,
            'changelog' => implode("\n", $lines),
            'source' => 'CHANGELOG ' . $version,
        ];
    }

    public static function versionFromPhpConfig(string $php): ?string
    {
        if (preg_match("/'version'\\s*=>\\s*'(\\d+\\.\\d+\\.\\d+)'/", $php, $m) === 1) {
            return $m[1];
        }

        return null;
    }

    public static function versionFromPackageJson(string $json): ?string
    {
        $data = json_decode($json, true);
        if (!is_array($data)) {
            return null;
        }
        $version = trim((string) ($data['version'] ?? ''));

        return preg_match('/^\\d+\\.\\d+\\.\\d+$/', $version) === 1 ? $version : null;
    }

    public static function section(string $markdown, string $heading): string
    {
        $quoted = preg_quote($heading, '/');
        if (preg_match('/^## \\[' . $quoted . '\\][^\\n]*\\n(.*?)(?=\\n## \\[|\\z)/sm', $markdown, $m) !== 1) {
            return '';
        }

        return trim($m[1]);
    }

    /**
     * @return list<string>
     */
    public static function bulletLines(string $section): array
    {
        $out = [];
        foreach (preg_split('/\\r\\n|\\r|\\n/', $section) ?: [] as $line) {
            $line = trim($line);
            if (!str_starts_with($line, '- ')) {
                continue;
            }
            $line = trim(substr($line, 2));
            $line = preg_replace('/^\\*\\*(.+?)\\*\\*\\s*[:：]\\s*/u', '$1：', $line) ?? $line;
            $line = str_replace(['**', '`'], '', $line);
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            $out[] = $line;
            if (count($out) >= 8) {
                break;
            }
        }

        return $out;
    }

    public static function sectionBlurb(string $section): string
    {
        if (preg_match('/^>\\s*(.+)$/mu', $section, $m) !== 1) {
            return '';
        }

        return trim(str_replace(['**', '`'], '', $m[1]));
    }

    public static function firstDatedVersion(string $markdown): ?string
    {
        if (preg_match('/^## \\[(\\d+\\.\\d+\\.\\d+)\\]/m', $markdown, $m) === 1) {
            return $m[1];
        }

        return null;
    }
}
