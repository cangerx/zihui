<?php

namespace App\Services\Tts;

use App\Models\TtsProvider;

/**
 * TTS 适配器: 服务端用 provider 的 key 代调上游, 返回原始音频字节。
 * 仅支持 HTTP-once(一次返回整段音频)的供应商; 签名鉴权/SSML/流式不在此层(由 UI 拒绝)。
 */
interface TtsAdapter
{
    /**
     * @return string 原始音频字节(按 provider.format)
     * @throws \RuntimeException 合成失败
     */
    public function synthesize(TtsProvider $provider, string $text, ?string $voice, float $speed): string;
}
