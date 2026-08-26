<?php

namespace Tests\Unit;

use App\Services\Video\Adapters\VolcengineArkPayload;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class VolcengineArkPayloadTest extends TestCase
{
    public function test_text_to_video_uses_official_content(): void
    {
        $payload = VolcengineArkPayload::build('doubao-seedance-2-0-260128', '海边日落', [
            'duration' => 5,
            'resolution' => '1080P',
            'aspect_ratio' => '16:9',
        ], []);

        $this->assertSame('doubao-seedance-2-0-260128', $payload['model']);
        $this->assertSame('1080p', $payload['resolution']);
        $this->assertSame(5, $payload['duration']);
        $this->assertSame('16:9', $payload['ratio']);
        $this->assertSame([['type' => 'text', 'text' => '海边日落']], $payload['content']);
    }

    public function test_first_last_frame_forces_adaptive(): void
    {
        $payload = VolcengineArkPayload::build('doubao-seedance-2-0-260128', '从近到远', [
            'mode' => 'first_last_frame',
            'duration' => 8,
            'resolution' => '720p',
            'aspect_ratio' => '16:9',
        ], [
            'assets' => [
                ['role' => 'first_frame', 'url' => 'https://cdn.example.com/a.png'],
                ['role' => 'last_frame', 'url' => 'https://cdn.example.com/b.png'],
            ],
        ]);

        $this->assertSame('adaptive', $payload['ratio']);
        $this->assertSame('first_frame', $payload['content'][1]['role']);
        $this->assertSame('last_frame', $payload['content'][2]['role']);
    }

    public function test_seedance_25_rejects_1080p_and_allows_30s(): void
    {
        $payload = VolcengineArkPayload::build('doubao-seedance-2-5', '城市夜景', [
            'duration' => 30,
            'resolution' => '1080p',
        ], []);

        $this->assertSame('720p', $payload['resolution']);
        $this->assertSame(30, $payload['duration']);
    }

    public function test_reference_video_uses_official_role(): void
    {
        $payload = VolcengineArkPayload::build('doubao-seedance-2-5', '沿用运镜', [
            'duration' => 10,
            'resolution' => '480p',
        ], [
            'assets' => [
                ['asset_type' => 'video', 'url' => 'https://cdn.example.com/ref.mp4'],
            ],
        ]);

        $this->assertSame('video_url', $payload['content'][1]['type']);
        $this->assertSame('reference_video', $payload['content'][1]['role']);
        $this->assertSame('480p', $payload['resolution']);
    }

    public function test_empty_content_is_rejected(): void
    {
        $this->expectException(InvalidArgumentException::class);
        VolcengineArkPayload::build('doubao-seedance-2-5', '  ', [], []);
    }
}
