<?php

namespace App\Services\Video\Adapters;

use InvalidArgumentException;

/**
 * 火山方舟官方视频生成任务体。
 * 简介：https://www.volcengine.com/docs/82379/1099455
 * 创建任务：https://www.volcengine.com/docs/82379/1520757
 * POST /api/v3/contents/generations/tasks
 */
class VolcengineArkPayload
{
    public const RATIOS = ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];

    /**
     * @param  array<string, mixed>  $params
     * @param  array<string, mixed>  $assets
     * @return array<string, mixed>
     */
    public static function build(string $modelId, string $prompt, array $params, array $assets): array
    {
        $model = trim($modelId);
        if ($model === '') {
            throw new InvalidArgumentException('火山方舟必须填写模型 ID');
        }

        $content = [];
        $text = trim($prompt);
        if ($text !== '') {
            $content[] = ['type' => 'text', 'text' => $text];
        }

        $mode = strtolower((string) ($params['mode'] ?? ''));
        $items = self::assetItems($assets);
        $firstLast = $mode === 'first_last_frame';
        $hasFrame = false;
        $hasReference = false;

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
                    $content[] = [
                        'type' => 'video_url',
                        'video_url' => ['url' => $url],
                        'role' => 'reference_video',
                    ];
                    $hasReference = true;
                    continue;
                }
                if ($role === 'reference_audio' || $type === 'audio') {
                    $content[] = [
                        'type' => 'audio_url',
                        'audio_url' => ['url' => $url],
                        'role' => 'reference_audio',
                    ];
                    $hasReference = true;
                    continue;
                }
                $imageRole = $role === 'reference_image' || $hasFrame ? 'reference_image' : 'first_frame';
                $content[] = self::imageItem($url, $imageRole);
                if ($imageRole === 'first_frame') {
                    $hasFrame = true;
                } else {
                    $hasReference = true;
                }
            }
        }

        if ($content === []) {
            throw new InvalidArgumentException('火山方舟至少需要提示词、图片或视频之一');
        }

        $payload = [
            'model' => $model,
            'content' => $content,
            'resolution' => self::normalizeResolution((string) ($params['resolution'] ?? ''), $model),
            'duration' => self::normalizeDuration((int) ($params['duration'] ?? $params['duration_seconds'] ?? 0), $model),
            'ratio' => self::normalizeRatio((string) ($params['aspect_ratio'] ?? $params['ratio'] ?? ''), $hasFrame),
        ];

        if (array_key_exists('generate_audio', $params)) {
            $payload['generate_audio'] = (bool) $params['generate_audio'];
        }
        if (array_key_exists('watermark', $params)) {
            $payload['watermark'] = (bool) $params['watermark'];
        }
        if (!empty($params['callback_url']) && is_string($params['callback_url'])) {
            $payload['callback_url'] = $params['callback_url'];
        }
        if (!empty($params['seed']) && is_numeric($params['seed'])) {
            $payload['seed'] = (int) $params['seed'];
        }

        return $payload;
    }

    public static function isSeedance25(string $modelId): bool
    {
        return (bool) preg_match('/2[\.\-_]?5/i', $modelId);
    }

    public static function normalizeResolution(string $raw, string $modelId): string
    {
        $value = strtolower(str_replace(' ', '', trim($raw)));
        $value = str_replace('p', 'p', $value);
        if (str_ends_with($value, 'p')) {
            $value = rtrim($value, 'p') . 'p';
        }
        if (self::isSeedance25($modelId)) {
            return in_array($value, ['480p', '720p'], true) ? $value : '720p';
        }
        if (in_array($value, ['480p', '720p', '1080p'], true)) {
            return $value;
        }
        return '720p';
    }

    public static function normalizeDuration(int $seconds, string $modelId): int
    {
        if ($seconds === -1 && self::isSeedance25($modelId)) {
            return -1;
        }
        $min = self::isSeedance25($modelId) ? 4 : 2;
        $max = self::isSeedance25($modelId) ? 30 : 15;
        if ($seconds < $min) {
            return 5;
        }
        if ($seconds > $max) {
            return $max;
        }
        return $seconds;
    }

    public static function normalizeRatio(string $raw, bool $hasFrame): string
    {
        if ($hasFrame) {
            return 'adaptive';
        }
        $value = trim($raw);
        if ($value === '') {
            return '16:9';
        }
        return in_array($value, self::RATIOS, true) ? $value : '16:9';
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
