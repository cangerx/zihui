<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * TTS 供应商(解说合成)。api_key 服务端持有, 输出层 mask, 永不下发桌面端。
 */
class TtsProvider extends Model
{
    protected $fillable = [
        'name', 'preset_type', 'endpoint', 'api_key',
        'auth', 'headers', 'body_template', 'response_type', 'audio_path',
        'format', 'voice_default', 'speed_default', 'config',
        'status', 'suspended_at', 'suspended_reason',
    ];

    protected $hidden = ['api_key'];

    protected $casts = [
        'auth'          => 'array',
        'headers'       => 'array',
        'config'        => 'array',
        'speed_default' => 'float',
        'suspended_at'  => 'datetime',
    ];

    /** 脱敏后的 key 展示(前4+***+后4), 对齐 ProviderCredentialController::present 风格 */
    public function maskedKey(): string
    {
        $k = (string) $this->api_key;
        if ($k === '') {
            return '';
        }
        if (strlen($k) <= 8) {
            return str_repeat('*', strlen($k));
        }
        return substr($k, 0, 4) . '***' . substr($k, -4);
    }
}
