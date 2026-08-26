<?php

namespace App\Services\Tts;

use App\Models\TtsProvider;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * 通用模板适配器: 覆盖多数 HTTP-once TTS。
 *   body_template 占位 {text}{voice}{speed}{format}{uuid} → JSON body;
 *   auth: {type:header|bearer|query, headerName, valueTemplate('Bearer {token}'等)};
 *   responseType: binary | json-base64(audio_path) | json-url(audio_path 为 URL, 二次下载)。
 * 不支持签名鉴权 / SSML / 流式(由 UI 拒绝, 引导预设档或自建 OpenAI 兼容反代)。
 */
class GenericTemplateAdapter implements TtsAdapter
{
    public function synthesize(TtsProvider $provider, string $text, ?string $voice, float $speed): string
    {
        $endpoint = $provider->endpoint ?: '';
        if ($endpoint === '') {
            throw new \RuntimeException('通用 TTS 未配置 endpoint');
        }

        $vars = [
            '{text}'   => $text,
            '{voice}'  => $voice ?: ($provider->voice_default ?: ''),
            '{speed}'  => (string) $speed,
            '{format}' => $provider->format ?: 'mp3',
            '{uuid}'   => (string) Str::uuid(),
        ];
        $bodyRaw = strtr((string) $provider->body_template, $vars);
        $body    = json_decode($bodyRaw, true);
        if (!is_array($body)) {
            throw new \RuntimeException('通用 TTS body_template 渲染后不是合法 JSON');
        }

        // 鉴权 + 自定义头
        $headers = [];
        foreach ((array) $provider->headers as $k => $v) {
            $headers[(string) $k] = (string) $v;
        }
        $query = [];
        $auth  = (array) $provider->auth;
        $token = (string) $provider->api_key;
        $authType = (string) ($auth['type'] ?? 'bearer');
        if ($authType === 'header') {
            $name  = (string) ($auth['headerName'] ?? 'Authorization');
            $value = strtr((string) ($auth['valueTemplate'] ?? '{token}'), ['{token}' => $token]);
            $headers[$name] = $value;
        } elseif ($authType === 'query') {
            $name = (string) ($auth['headerName'] ?? 'key');
            $query[$name] = $token;
        } else { // bearer
            $headers['Authorization'] = strtr((string) ($auth['valueTemplate'] ?? 'Bearer {token}'), ['{token}' => $token]);
        }

        $url  = $query ? ($endpoint . (str_contains($endpoint, '?') ? '&' : '?') . http_build_query($query)) : $endpoint;
        $resp = Http::timeout(120)->withHeaders($headers)->post($url, $body);
        if (!$resp->successful()) {
            throw new \RuntimeException('通用 TTS HTTP ' . $resp->status() . ': ' . $resp->body());
        }

        switch ($provider->response_type) {
            case 'binary':
                return $resp->body();
            case 'json-base64': {
                $val = $this->dig($resp->json(), $provider->audio_path);
                $bytes = is_string($val) ? base64_decode($val, true) : false;
                if ($bytes === false) {
                    throw new \RuntimeException('通用 TTS json-base64 取/解码失败 (audio_path=' . $provider->audio_path . ')');
                }
                return $bytes;
            }
            case 'json-url': {
                $u = $this->dig($resp->json(), $provider->audio_path);
                if (!is_string($u) || $u === '') {
                    throw new \RuntimeException('通用 TTS json-url 未取到音频地址');
                }
                $a = Http::timeout(120)->get($u);
                if (!$a->successful()) {
                    throw new \RuntimeException('通用 TTS 二次下载音频失败 HTTP ' . $a->status());
                }
                return $a->body();
            }
            default:
                throw new \RuntimeException('不支持的 response_type: ' . $provider->response_type);
        }
    }

    /** 按点路径取嵌套值(如 'data.audio') */
    private function dig(mixed $json, string $path): mixed
    {
        if (!is_array($json) || $path === '') {
            return is_array($json) ? null : $json;
        }
        $cur = $json;
        foreach (explode('.', $path) as $seg) {
            if (is_array($cur) && array_key_exists($seg, $cur)) {
                $cur = $cur[$seg];
            } else {
                return null;
            }
        }
        return $cur;
    }
}
