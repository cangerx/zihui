<?php

namespace Tests\Unit;

use App\Services\SiteUpdate\SiteUpdateFeedService;
use PHPUnit\Framework\TestCase;

class SiteUpdateFeedServiceTest extends TestCase
{
    public function test_changelog_lines_split_and_strip_bullets(): void
    {
        $svc = new SiteUpdateFeedService();
        $this->assertSame(
            ['修复 Windows 云打包大图', '提示词右键复制粘贴'],
            $svc->changelogLines("- 修复 Windows 云打包大图\n• 提示词右键复制粘贴")
        );
    }

    public function test_changelog_lines_empty(): void
    {
        $svc = new SiteUpdateFeedService();
        $this->assertSame([], $svc->changelogLines('  '));
    }
}
