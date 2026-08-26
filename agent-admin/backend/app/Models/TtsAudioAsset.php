<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * TTS 合成产物登记(按字符计费 + 即拉即用清理依据)。
 */
class TtsAudioAsset extends Model
{
    protected $fillable = [
        'user_id', 'provider_id', 'text_hash', 'char_count',
        'voice', 'format', 'storage_url', 'size', 'status', 'error',
    ];

    protected $casts = [
        'user_id'    => 'integer',
        'provider_id' => 'integer',
        'char_count' => 'integer',
        'size'       => 'integer',
    ];
}
