<?php

namespace Tests\Unit;

use App\Services\Video\Adapters\MiniMaxH3Payload;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class MiniMaxH3PayloadTest extends TestCase
{
    public function test_text_to_video_requires_concrete_ratio(): void
    {
        $payload = MiniMaxH3Payload::build('MiniMax-H3', '海边打球', [
            'duration' => 5,
            'resolution' => '2k',
        ], []);

        $this->assertSame('MiniMax-H3', $payload['model']);
        $this->assertSame('2K', $payload['resolution']);
        $this->assertSame(5, $payload['duration']);
        $this->assertSame('16:9', $payload['ratio']);
        $this->assertSame([['type' => 'text', 'text' => '海边打球']], $payload['content']);
    }

    public function test_first_last_frame_forces_adaptive_ratio(): void
    {
        $payload = MiniMaxH3Payload::build('MiniMax-H3', '拉近背景', [
            'mode' => 'first_last_frame',
            'duration' => 8,
            'resolution' => '768P',
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

    public function test_reference_media_uses_official_roles(): void
    {
        $payload = MiniMaxH3Payload::build('MiniMax-H3', '跟参考视频跳舞', [
            'duration' => 6,
            'resolution' => '2K',
        ], [
            'assets' => [
                ['asset_type' => 'video', 'url' => 'https://cdn.example.com/ref.mp4'],
                ['asset_type' => 'audio', 'url' => 'https://cdn.example.com/ref.mp3'],
            ],
        ]);

        $this->assertSame('reference_video', $payload['content'][1]['role']);
        $this->assertSame('reference_audio', $payload['content'][2]['role']);
        $this->assertSame('adaptive', $payload['ratio']);
    }

    public function test_empty_prompt_is_rejected(): void
    {
        $this->expectException(InvalidArgumentException::class);
        MiniMaxH3Payload::build('MiniMax-H3', '  ', ['duration' => 5], []);
    }
}
