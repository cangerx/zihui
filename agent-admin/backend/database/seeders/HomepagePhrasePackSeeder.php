<?php

namespace Database\Seeders;

use App\Models\HomepagePhrasePack;
use Illuminate\Database\Seeder;

/**
 * 内置行业话术包种子数据。
 *
 * 策略：
 *  - firstOrCreate(template, slug) 唯一定位，已存在则跳过 → 不会覆盖用户编辑后的内置包
 *  - 用户主动 apply 后才会写入 SystemSetting；只跑 seeder 不会改变前台官网展示
 *  - 内置包 is_builtin=true，前端禁止删除（payload 仍可编辑）
 *
 * 首批内置（仅 minimal 模板）：
 *  - general：通用版（payload 留空 → apply 后专属字段全部 reset 回退到 TEXT_KEYS 默认值）
 *  - advertising：广告/营销行业版（payload 包含全套行业化文案）
 *
 * default 模板（即历史官网）目前不需要话术包：它的内容由后台 HomepageSettings 直接编辑通用字段。
 */
class HomepagePhrasePackSeeder extends Seeder
{
    public function run(): void
    {
        // ========== minimal/general：通用版（默认） ==========
        HomepagePhrasePack::firstOrCreate(
            ['template' => 'minimal', 'slug' => 'general'],
            [
                'name'        => '通用版',
                'description' => '面向通用桌面 AI 工作站定位，适合大多数场景',
                // payload 留空：apply 时会清空 minimal_* 全部专属字段，
                // 前台 publicConfig 拉到空值后自动回退到 TEXT_KEYS 默认值
                'payload'     => [],
                'is_builtin'  => true,
                'sort_order'  => 0,
            ]
        );

        // ========== minimal/advertising：广告/营销版 ==========
        HomepagePhrasePack::firstOrCreate(
            ['template' => 'minimal', 'slug' => 'advertising'],
            [
                'name'        => '广告/营销版',
                'description' => 'AI 物料、海报、营销文案、品牌创意工作流',
                'payload'     => [
                    // Section 1: 创作能力
                    'minimal_section_create_badge' => '营销创作',
                    'minimal_section_create_title' => 'AI 生成你的下一波物料',
                    'minimal_section_create_desc'  => '海报、Banner、商品图、营销字体、社媒封面，对话生成、批量出图、统一风格。',
                    // Section 2: 对话能力
                    'minimal_section_chat_badge' => '营销文案',
                    'minimal_section_chat_title' => '你的营销文案助手',
                    'minimal_section_chat_desc'  => '种草文案、产品介绍、活动方案、社媒推文，一句话生成多版方案。',
                    // Section 3: 双特性卡
                    'minimal_feat_kb_title'     => '品牌知识库',
                    'minimal_feat_kb_desc'      => '导入品牌手册、产品资料、历史素材，AI 出物料始终贴合品牌调性。',
                    'minimal_feat_memory_title' => '客户记忆',
                    'minimal_feat_memory_desc'  => '为每个客户建立独立上下文，下次出物料无需重复说明背景。',
                    // Section 4: 六宫格
                    'minimal_grid_1_title' => 'BYOK 模型自由',
                    'minimal_grid_1_desc'  => '接入你信赖的 LLM / 文生图模型服务，按需切换',
                    'minimal_grid_2_title' => '工具自治',
                    'minimal_grid_2_desc'  => 'AI 自主调用图像、文档、命令工具，端到端跑完营销链路',
                    'minimal_grid_3_title' => '多 Agent 协作',
                    'minimal_grid_3_desc'  => '策划、文案、设计、出图分工协作，复杂活动一气呵成',
                    'minimal_grid_4_title' => '插件生态',
                    'minimal_grid_4_desc'  => 'Skill + MCP，挂接电商、社媒、数据看板等业务系统',
                    'minimal_grid_5_title' => '数据本地',
                    'minimal_grid_5_desc'  => '客户资料、品牌素材、历史方案，全部存于本地 SQLite',
                    'minimal_grid_6_title' => '流式画布',
                    'minimal_grid_6_desc'  => '拖拽编排创意工作流，从 brief 到成品一条线',
                    // Section 5: 双 CTA
                    'minimal_cta_left_title'  => '加入营销人交流群',
                    'minimal_cta_left_desc'   => '与同行交流 AI 营销实战',
                    'minimal_cta_right_title' => '营销场景文档',
                    'minimal_cta_right_desc'  => '了解 AI 在你的行业能落到哪里',
                ],
                'is_builtin'  => true,
                'sort_order'  => 10,
            ]
        );
    }
}
