<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Doc extends Model
{
    protected $fillable = [
        'category_id', 'title', 'subtitle', 'content_html', 'content_plain',
        'slug', 'is_visible', 'sort_order', 'view_count', 'import_source',
    ];

    protected $casts = [
        'is_visible'  => 'boolean',
        'sort_order'  => 'integer',
        'view_count'  => 'integer',
    ];

    public function category(): BelongsTo
    {
        return $this->belongsTo(DocCategory::class, 'category_id');
    }

    public function chunks(): HasMany
    {
        return $this->hasMany(DocChunk::class, 'doc_id');
    }

    /**
     * 把富文本 HTML 转成搜索用的 plain text。
     * 入库前调用：剥标签 + decode 实体 + 合并空白。
     */
    public static function htmlToPlain(?string $html): string
    {
        if ($html === null || $html === '') return '';
        $text = strip_tags($html);
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = preg_replace('/\s+/u', ' ', $text);
        return trim((string) $text);
    }
}
