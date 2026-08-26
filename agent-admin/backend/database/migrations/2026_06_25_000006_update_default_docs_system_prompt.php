<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * 一次性同步：把已升级客户的 docs_system_prompt 旧默认值替换为新默认值。
 *
 * 背景：1.3.13 及之前的默认 prompt 用「必须」「不允许」等强约束，对寒暄类
 * 问题（你好 / hi）会触发「未找到相关信息」并机械附 [1] [2] 引用编号。
 * 新默认值加入寒暄豁免 + 引用规则只在真引用文档时使用。
 *
 * 同步策略：
 *   - DB 中现值 ===  旧默认值 → 替换为新默认值（沿用默认的客户自动升级）
 *   - DB 中现值 !== 旧默认值 → 保持不动（客户已自定义，尊重客户配置）
 *   - DB 中无该行            → 不插入（getValue 会自动回落到 DEFAULT_VALUES，下一版即吃到新值）
 *
 * 铁律：只用 Schema::/DB:: 原生 API，不引 SystemSetting Model。
 */
return new class extends Migration {
    /** 1.3.13 及之前的默认提示词，原文必须一字不差以便精确匹配 */
    private const OLD_DEFAULT = "你是「{site_title}」的文档助手。你必须严格遵守以下规则：\n\n1. 只能基于下方 <文档片段> 中的内容回答问题。\n2. 如果 <文档片段> 中没有足够信息回答用户问题，必须直接回答「抱歉，文档中未找到相关信息」，不允许编造。\n3. 不要使用任何外部知识。\n4. 回答末尾以 [1] [2] 这样的标号引用具体片段。\n\n<文档片段>\n{context}\n</文档片段>\n\n用户问题：{query}";

    /** 1.3.14+ 的新默认提示词，与 SystemSetting::DEFAULT_VALUES 中的值保持同步 */
    private const NEW_DEFAULT = "你是「{site_title}」的文档助手。请按以下原则回答用户问题：\n\n1. 优先依据下方 <文档片段> 回答；如果文档里有相关信息，请清晰、有条理地总结，并在引用某段时在末尾用 [1] [2] 标注来源。\n2. 如果用户在打招呼、寒暄或问你是谁，请友好简短回应一两句，并主动告诉用户你可以帮他查站内文档，邀请他提具体问题。这种情况下不要带 [1] [2]。\n3. 如果 <文档片段> 不足以回答用户的具体问题，回答「抱歉，我在文档里没有找到相关信息，可以换个说法或换个关键词再试一下」，不要带 [1] [2]，不要编造。\n4. 不要使用文档之外的外部知识回答业务问题。\n\n<文档片段>\n{context}\n</文档片段>\n\n用户问题：{query}";

    public function up(): void
    {
        // 表不存在（极端早期升级路径）直接跳过；正常 system_settings 在 Laravel 安装时由
        // 主项目 framework migration 创建，此处仅做防御
        if (!Schema::hasTable('system_settings')) {
            return;
        }

        $current = DB::table('system_settings')
            ->where('key', 'docs_system_prompt')
            ->value('value');

        if ($current === self::OLD_DEFAULT) {
            DB::table('system_settings')
                ->where('key', 'docs_system_prompt')
                ->update([
                    'value'      => self::NEW_DEFAULT,
                    'updated_at' => now(),
                ]);
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable('system_settings')) {
            return;
        }

        $current = DB::table('system_settings')
            ->where('key', 'docs_system_prompt')
            ->value('value');

        if ($current === self::NEW_DEFAULT) {
            DB::table('system_settings')
                ->where('key', 'docs_system_prompt')
                ->update([
                    'value'      => self::OLD_DEFAULT,
                    'updated_at' => now(),
                ]);
        }
    }
};
