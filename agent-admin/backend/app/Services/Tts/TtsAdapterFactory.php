<?php

namespace App\Services\Tts;

use App\Models\TtsProvider;

class TtsAdapterFactory
{
    /** 按 preset_type 选适配器 */
    public static function make(TtsProvider $provider): TtsAdapter
    {
        return match ($provider->preset_type) {
            'openai_compatible' => new OpenAiTtsAdapter(),
            'generic'           => new GenericTemplateAdapter(),
            default             => new DoubaoTtsAdapter(), // doubao
        };
    }
}
