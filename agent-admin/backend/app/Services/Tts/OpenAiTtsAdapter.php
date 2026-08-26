<?php

namespace App\Services\Tts;

use App\Models\TtsProvider;
use Illuminate\Support\Facades\Http;

/**
 * OpenAI 兼容 TTS(/v1/audio/speech): Bearer 鉴权, body 固定 {model,input,voice,response_format,speed},
 * 返回裸二进制音频。可对接任何 OpenAI 兼容反代/中转。
 */
class OpenAiTtsAdapter implements TtsAdapter
{
    public function synthesize(TtsProvider $provider, string $text, ?string $voice, float $speed): string
    {
        $config   = (array) $provider->config;
        $endpoint = $provider->endpoint ?: '';
        if ($endpoint === '') {
            throw new \RuntimeException('OpenAI TTS 未配置 endpoint');
        }

        $resp = Http::timeout(120)
            ->withToken((string) $provider->api_key)
            ->post($endpoint, [
                'model'           => (string) ($config['model'] ?? 'tts-1'),
                'input'           => $text,
                'voice'           => $voice ?: ($provider->voice_default ?: 'alloy'),
                'response_format' => $provider->format ?: 'mp3',
                'speed'           => $speed,
            ]);

        if (!$resp->successful()) {
            throw new \RuntimeException('OpenAI TTS HTTP ' . $resp->status() . ': ' . $resp->body());
        }
        return $resp->body();
    }
}
