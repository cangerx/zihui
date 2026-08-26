<?php

namespace Tests\Unit;

use App\Support\RetiredPublicHosts;
use PHPUnit\Framework\TestCase;

class RetiredPublicHostsTest extends TestCase
{
    public function test_retired_host_is_detected_from_url_and_host(): void
    {
        $this->assertTrue(RetiredPublicHosts::contains('https://ai.haohuoban.com'));
        $this->assertTrue(RetiredPublicHosts::contains('https://ai.haohuoban.com/storage/icon.png'));
        $this->assertTrue(RetiredPublicHosts::contains('ai.haohuoban.com'));
        $this->assertFalse(RetiredPublicHosts::contains('https://agent.haohuoban.com'));
        $this->assertFalse(RetiredPublicHosts::contains(''));
    }

    public function test_rewrite_replaces_retired_origin(): void
    {
        $this->assertSame(
            'https://agent.haohuoban.com/storage/icon.png',
            RetiredPublicHosts::rewrite(
                'https://ai.haohuoban.com/storage/icon.png',
                'https://agent.haohuoban.com'
            )
        );
        $this->assertSame(
            'https://agent.haohuoban.com/ok.png',
            RetiredPublicHosts::rewrite('https://agent.haohuoban.com/ok.png', 'https://agent.haohuoban.com')
        );
    }
}
