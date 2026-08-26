<?php

namespace App\Services\Tts;

use App\Models\TtsProvider;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * 豆包/火山 openspeech TTS。四段 body(app/user/audio/request), 返回 json-base64(data 字段)。
 * 鉴权: Authorization: 'Bearer;<access_token>'。config: app_id / cluster(默认 volcano_icl)。
 */
class DoubaoTtsAdapter implements TtsAdapter
{
    public function synthesize(TtsProvider $provider, string $text, ?string $voice, float $speed): string
    {
        $config   = (array) $provider->config;
        $endpoint = $provider->endpoint ?: 'https://openspeech.bytedance.com/api/v1/tts';
        $token    = (string) $provider->api_key;

        $body = [
            'app' => [
                'appid'   => (string) ($config['app_id'] ?? ''),
                'token'   => $token,
                'cluster' => (string) ($config['cluster'] ?? 'volcano_icl'),
            ],
            'user'  => ['uid' => (string) Str::uuid()],
            'audio' => [
                'voice_type'  => $voice ?: ($provider->voice_default ?: 'zh_female_1'),
                'encoding'    => $provider->format ?: 'mp3',
                'speed_ratio' => $speed,
            ],
            'request' => [
                'reqid'     => (string) Str::uuid(),
                'text'      => $text,
                'operation' => 'query',
            ],
        ];

        $resp = Http::timeout(120)
            ->withHeaders(['Authorization' => 'Bearer;' . $token])
            ->post($endpoint, $body);

        if (!$resp->successful()) {
            throw new \RuntimeException('豆包 TTS HTTP ' . $resp->status() . ': ' . $resp->body());
        }
        $json = $resp->json();
        $data = is_array($json) ? ($json['data'] ?? '') : '';
        if (!is_string($data) || $data === '') {
            throw new \RuntimeException('豆包 TTS 返回无音频 data: ' . $resp->body());
        }
        $bytes = base64_decode($data, true);
        if ($bytes === false) {
            throw new \RuntimeException('豆包 TTS base64 解码失败');
        }
        return $bytes;
    }
}
