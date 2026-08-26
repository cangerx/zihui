<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * AI Deck 资源资产(ffmpeg / 声明式模板包)。见 migration create_deck_resource_assets_table。
 */
class DeckResourceAsset extends Model
{
    protected $fillable = [
        'kind', 'asset_key', 'platform', 'version',
        'source_url', 'sha256', 'size', 'local_path',
        'status', 'error', 'oem_project_key', 'meta',
    ];

    protected $casts = [
        'size' => 'integer',
        'meta' => 'array',
    ];
}
