<?php

namespace App\Services\Video;

use App\Models\VideoProviderAccount;
use App\Services\Video\Adapters\DuomiVideoProvider;
use App\Services\Video\Adapters\MiniMaxH3VideoProvider;
use App\Services\Video\Adapters\OpenAiVideoProvider;
use App\Services\Video\Adapters\VolcengineArkVideoProvider;
use App\Services\Video\Adapters\WanVideoProvider;

class VideoProviderManager
{
    public function driver(VideoProviderAccount $account): VideoProviderInterface
    {
        return match ($this->driverKey($account)) {
            'duomi' => app(DuomiVideoProvider::class),
            'wan' => app(WanVideoProvider::class),
            'minimax_h3' => app(MiniMaxH3VideoProvider::class),
            'volcengine_ark' => app(VolcengineArkVideoProvider::class),
            // openai 兼容族 + 未知驱动一律回落 OpenAI 兼容视频协议，保证可扩展
            default => app(OpenAiVideoProvider::class),
        };
    }

    /**
     * 解析账号的驱动类型：优先 config.driver，其次按 provider_key 推断。
     */
    public function driverKey(VideoProviderAccount $account): string
    {
        $config = is_array($account->config) ? $account->config : [];
        $driver = strtolower(trim((string) ($config['driver'] ?? '')));
        if (in_array($driver, ['duomi', 'openai_video', 'wan', 'minimax_h3', 'volcengine_ark'], true)) {
            return $driver;
        }

        $key = strtolower((string) $account->provider_key);
        if ($key === 'duomi') {
            return 'duomi';
        }
        if (in_array($key, ['wan', 'likeadmin', 'dashscope'], true)) {
            return 'wan';
        }
        if (in_array($key, ['minimax', 'minimax_h3', 'hailuo'], true)) {
            return 'minimax_h3';
        }
        if (in_array($key, ['volcengine', 'volcengine_ark', 'ark', 'jimeng'], true)) {
            return 'volcengine_ark';
        }
        return 'openai_video';
    }
}
