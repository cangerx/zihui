<?php

namespace App\Services\Video\Adapters;

use InvalidArgumentException;

/**
 * MiniMax H3 V2 提交体。契约：https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create
 */
class MiniMaxH3Payload
{
    public const MODEL = 'MiniMax-H3';
    public const RESOLUTIONS = ['768P', '2K'];
    public const RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];

    /**
     * @param  array<string, mixed>  $params
     * @param  array<string, mixed>  $assets
     * @return array<string, mixed>
     */
    public static function build(string $modelId, string $prompt, array $params, array $assets): array
    {
        $text = trim($prompt);
        if ($text === '') {
            throw new InvalidArgumentException('MiniMax H3 必须填写提示词');
        }

        $content = [['type' => 'text', 'text' => $text]];
        $mode = strtolower((string) ($params['mode'] ?? ''));
        $items = self::assetItems($assets);
        $firstLast = $mode === 'first_last_frame';
        $hasReference = false;
        $hasFrame = false;

        $first = self::firstAsset($items, 'first_frame');
        $last = self::firstAsset($items, 'last_frame');
        if ($firstLast || $first || $last) {
            if ($first) {
                $content[] = self::imageItem((string) $first['url'], 'first_frame');
                $hasFrame = true;
            }
            if ($last) {
                $content[] = self::imageItem((string) $last['url'], 'last_frame');
                $hasFrame = true;
            }
        }

        if (!$firstLast) {
            foreach ($items as $asset) {
                $url = trim((string) ($asset['url'] ?? ''));
                if ($url === '') {
                    continue;
                }
                $role = strtolower((string) ($asset['role'] ?? ''));
                $type = strtolower((string) ($asset['asset_type'] ?? ''));
                if (in_array($role, ['first_frame', 'last_frame'], true)) {
                    continue;
                }
                if ($role === 'reference_video' || $type === 'video') {
                    $content[] = ['type' => 'video_url', 'video_url' => ['url' => $url], 'role' => 'reference_video'];
                    $hasReference = true;
                    continue;
                }
                if ($role === 'reference_audio' || $type === 'audio') {
                    $content[] = ['type' => 'audio_url', 'audio_url' => ['url' => $url], 'role' => 'reference_audio'];
                    $hasReference = true;
                    continue;
                }
                if ($hasFrame) {
                    continue;
                }
                $content[] = self::imageItem($url, $role === 'reference_image' ? 'reference_image' : 'first_frame');
                if ($role === 'reference_image') {
                    $hasReference = true;
                } else {
                    $hasFrame = true;
                }
            }
        }

        if ($hasReference && $hasFrame) {
            throw new InvalidArgumentException('MiniMax H3 图生视频与多模态参考不能混用');
        }

        $resolution = self::normalizeResolution((string) ($params['resolution'] ?? ''));
        $duration = self::normalizeDuration((int) ($params['duration'] ?? $params['duration_seconds'] ?? 0));
        $ratio = self::normalizeRatio((string) ($params['aspect_ratio'] ?? $params['ratio'] ?? ''), $hasFrame, $hasReference);

        $payload = [
            'model' => $modelId !== '' ? $modelId : self::MODEL,
            'content' => $content,
            'resolution' => $resolution,
            'duration' => $duration,
            'ratio' => $ratio,
        ];

        if (array_key_exists('aigc_watermark', $params)) {
            $payload['aigc_watermark'] = (bool) $params['aigc_watermark'];
        }

        return $payload;
    }

    public static function normalizeResolution(string $raw): string
    {
        $value = strtoupper(str_replace(' ', '', trim($raw)));
        if ($value === '2K') {
            return '2K';
        }
        if (in_array($value, ['768P', '768'], true)) {
            return '768P';
        }
        return '768P';
    }

    public static function normalizeDuration(int $seconds): int
    {
        if ($seconds < 4) {
            return 5;
        }
        if ($seconds > 15) {
            return 15;
        }
        return $seconds;
    }

    public static function normalizeRatio(string $raw, bool $hasFrame, bool $hasReference): string
    {
        $value = trim($raw);
        if ($hasFrame) {
            return 'adaptive';
        }
        if ($value === '' || strtolower($value) === 'adaptive') {
            return $hasReference ? 'adaptive' : '16:9';
        }
        return in_array($value, self::RATIOS, true) ? $value : ($hasReference ? 'adaptive' : '16:9');
    }

    /**
     * @param  array<string, mixed>  $assets
     * @return list<array<string, mixed>>
     */
    private static function assetItems(array $assets): array
    {
        $items = [];
        if (is_array($assets['assets'] ?? null)) {
            foreach ($assets['assets'] as $asset) {
                if (is_array($asset)) {
                    $items[] = $asset;
                }
            }
            return $items;
        }
        foreach (['images' => 'image', 'videos' => 'video', 'audios' => 'audio'] as $key => $type) {
            foreach ((array) ($assets[$key] ?? []) as $url) {
                if (is_string($url) && $url !== '') {
                    $items[] = ['asset_type' => $type, 'url' => $url];
                }
            }
        }
        return $items;
    }

    /**
     * @param  list<array<string, mixed>>  $items
     * @return array<string, mixed>|null
     */
    private static function firstAsset(array $items, string $role): ?array
    {
        foreach ($items as $asset) {
            if (strtolower((string) ($asset['role'] ?? '')) === $role && !empty($asset['url'])) {
                return $asset;
            }
        }
        return null;
    }

    /**
     * @return array{type:string,image_url:array{url:string},role:string}
     */
    private static function imageItem(string $url, string $role): array
    {
        return [
            'type' => 'image_url',
            'image_url' => ['url' => $url],
            'role' => $role,
        ];
    }
}
