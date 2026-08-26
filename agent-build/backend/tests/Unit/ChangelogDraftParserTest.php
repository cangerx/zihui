<?php

namespace Tests\Unit;

use App\Services\ReleaseDraft\ChangelogDraftParser;
use PHPUnit\Framework\TestCase;

class ChangelogDraftParserTest extends TestCase
{
    public function test_prefers_unreleased_bullets_with_version_php(): void
    {
        $md = <<<MD
## [Unreleased]

### 新增

- **在线更新源**：默认从授权端检查。
- **模板版本**：跟随授权端当前桌面模板。

## [1.6.42] - 2026-08-22

- 旧条目不应出现
MD;
        $draft = ChangelogDraftParser::fromMarkdown($md, '1.6.42');
        $this->assertSame('1.6.42', $draft['version']);
        $this->assertStringContainsString('在线更新源', $draft['changelog']);
        $this->assertStringNotContainsString('旧条目', $draft['changelog']);
    }

    public function test_falls_back_to_dated_section(): void
    {
        $md = <<<MD
## [1.3.1] - 2026-08-24

> **圆角图标。**

### 修复

- **提示词编辑**：右键可复制粘贴。
MD;
        $draft = ChangelogDraftParser::fromMarkdown($md, '1.3.1');
        $this->assertSame('1.3.1', $draft['version']);
        $this->assertStringContainsString('圆角图标', $draft['changelog']);
        $this->assertStringContainsString('提示词编辑', $draft['changelog']);
    }

    public function test_version_from_php_config(): void
    {
        $php = "return [\n    'version' => '1.6.42',\n];\n";
        $this->assertSame('1.6.42', ChangelogDraftParser::versionFromPhpConfig($php));
    }
}
