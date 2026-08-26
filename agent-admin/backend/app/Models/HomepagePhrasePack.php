<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * 行业话术包模型。每条记录代表一套"行业版"文案预设（如"营销版"、"通用版"），
 * payload 是 { 字段 key => 值 } 的 JSON 映射，apply 时批量写入 SystemSetting。
 *
 * 与 HomepageController 的关系：
 *  - HomepageController::TEXT_KEYS 定义了所有可写字段的白名单
 *  - HomepagePhrasePackController::apply 在写入 SystemSetting 前会校验 payload 的 key
 *    必须落在白名单内，避免话术包写入未声明的字段
 */
class HomepagePhrasePack extends Model
{
    protected $fillable = [
        'template', 'slug', 'name', 'description', 'payload', 'is_builtin', 'sort_order',
    ];

    protected $casts = [
        'payload'    => 'array',
        'is_builtin' => 'boolean',
        'sort_order' => 'integer',
    ];

    /**
     * slug 命名规范：英文小写、数字、下划线、连字符
     * 与 Controller 的 regex 校验保持一致
     */
    public const SLUG_REGEX = '/^[a-z0-9_-]+$/';
}
