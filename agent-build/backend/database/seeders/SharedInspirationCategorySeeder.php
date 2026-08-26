<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * 共享灵感库：22 个标准分类（v3 编排，补全设计 / 电商细分）。
 *
 * 分组：
 *   - 题材-人事物（画什么）：portrait / landscape / architecture / food / pets
 *   - 题材-商品：product（通用兑底） / clothing / cosmetics / jewelry / home-living
 *   - 风格类（怎么画）：photography / illustration / anime / chinese-style / 3d-render / minimalism
 *   - 用途-展示（拿来干什么）：poster / logo / wallpaper
 *   - 用途-设计：banner / icon / social-media
 *
 * 维护要点：
 * - 用 (slug) 做幂等键，多次执行不会重复
 * - 已有同 slug 行只更新 name / sort_order，不重置 created_at
 * - 分类列表可由平台后台增删改，但 slug 改动需谨慎（云控端可能用 slug 做本地映射缓存）
 * - sort_order 分段：题材-人事物 0-40、题材-商品 50-58、风格 60-110、用途-展示 120-140、用途-设计 145-155
 *
 * v1 → v2 变更：
 * - 新增 5：product / minimalism / poster / logo / wallpaper
 * - 不再 seed：fashion / sci-fi / fantasy / cyberpunk（属于风格关键词，更适合写在 prompt 而非分类）
 *
 * v2 → v3 变更：
 * - 新增 7：clothing / cosmetics / jewelry / home-living（电商细分）+ banner / icon / social-media（设计细分）
 * - 现有 15 个 slug 与 sort_order 全部保持原值不动，仅插入 7 行
 *
 * 不主动 DELETE 任何 slug：旧行可能仍有灵感外键引用 / 管理员手工增加的过期 slug（
 * v1 遗留的 fashion / sci-fi / fantasy / cyberpunk，或生产管理员后台加的自定义 slug）都由平台后台
 * 「分类管理」按需手工删除（删前自动校验关联灵感数防误删）。
 */
class SharedInspirationCategorySeeder extends Seeder
{
    public function run(): void
    {
        $now = now();

        $categories = [
            // 题材-人事物（0-40）
            ['slug' => 'portrait',      'name' => '人物肖像',   'sort_order' =>   0],
            ['slug' => 'landscape',     'name' => '风景自然',   'sort_order' =>  10],
            ['slug' => 'architecture',  'name' => '建筑空间',   'sort_order' =>  20],
            ['slug' => 'food',          'name' => '美食料理',   'sort_order' =>  30],
            ['slug' => 'pets',          'name' => '可爱萌宠',   'sort_order' =>  40],
            // 题材-商品（50-58）
            ['slug' => 'product',       'name' => '商品产品',   'sort_order' =>  50],
            ['slug' => 'clothing',      'name' => '服装鞋帽',   'sort_order' =>  52],
            ['slug' => 'cosmetics',     'name' => '美妆护肤',   'sort_order' =>  54],
            ['slug' => 'jewelry',       'name' => '珠宝首饰',   'sort_order' =>  56],
            ['slug' => 'home-living',   'name' => '家居家具',   'sort_order' =>  58],
            // 风格类（怎么画）：60-110
            ['slug' => 'photography',   'name' => '写实摄影',   'sort_order' =>  60],
            ['slug' => 'illustration',  'name' => '插画绘本',   'sort_order' =>  70],
            ['slug' => 'anime',         'name' => '二次元动漫', 'sort_order' =>  80],
            ['slug' => 'chinese-style', 'name' => '国风古韵',   'sort_order' =>  90],
            ['slug' => '3d-render',     'name' => '3D 渲染',     'sort_order' => 100],
            ['slug' => 'minimalism',    'name' => '极简平面',   'sort_order' => 110],
            // 用途-展示（拿来干什么）：120-140
            ['slug' => 'poster',        'name' => '海报封面',   'sort_order' => 120],
            ['slug' => 'logo',          'name' => 'Logo 标识',   'sort_order' => 130],
            ['slug' => 'wallpaper',     'name' => '壁纸背景',   'sort_order' => 140],
            // 用途-设计（145-155）
            ['slug' => 'banner',        'name' => '横幅 Banner', 'sort_order' => 145],
            ['slug' => 'icon',          'name' => '图标 Icon',   'sort_order' => 150],
            ['slug' => 'social-media',  'name' => '社交配图',   'sort_order' => 155],
        ];

        foreach ($categories as $row) {
            DB::table('shared_inspiration_categories')->updateOrInsert(
                ['slug' => $row['slug']],
                [
                    'name'       => $row['name'],
                    'sort_order' => $row['sort_order'],
                    'updated_at' => $now,
                    'created_at' => $now,  // updateOrInsert update 分支不会覆盖已存在的 created_at
                ]
            );
        }
    }
}
