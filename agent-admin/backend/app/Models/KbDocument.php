<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class KbDocument extends Model
{
    public const SOURCE_RICHTEXT = 'richtext';
    public const SOURCE_UPLOAD = 'upload';

    public const STATUS_PENDING = 'pending';
    public const STATUS_PROCESSING = 'processing';
    public const STATUS_READY = 'ready';
    public const STATUS_FAILED = 'failed';

    protected $fillable = [
        'kb_id', 'title', 'source_type', 'original_filename',
        'content_html', 'content_plain', 'file_size',
        'index_status', 'index_error', 'chunk_count', 'sort_order',
    ];

    protected $casts = [
        'kb_id'        => 'integer',
        'file_size'    => 'integer',
        'chunk_count'  => 'integer',
        'sort_order'   => 'integer',
    ];

    public function knowledgeBase(): BelongsTo
    {
        return $this->belongsTo(KnowledgeBase::class, 'kb_id');
    }

    public function chunks(): HasMany
    {
        return $this->hasMany(KbChunk::class, 'document_id');
    }

    /**
     * 富文本 HTML 转检索用纯文本：剥标签 + decode 实体 + 合并空白。
     */
    public static function htmlToPlain(?string $html): string
    {
        if ($html === null || $html === '') {
            return '';
        }
        $text = strip_tags($html);
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = preg_replace('/\s+/u', ' ', $text);
        return trim((string) $text);
    }
}
