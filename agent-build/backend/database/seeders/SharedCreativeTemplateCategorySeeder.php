<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class SharedCreativeTemplateCategorySeeder extends Seeder
{
    public function run(): void
    {
        $items = [
            ['name' => '人像摄影', 'slug' => 'portrait-photography', 'sort_order' => 10],
            ['name' => '商品海报', 'slug' => 'product-poster', 'sort_order' => 20],
            ['name' => '电商主图', 'slug' => 'ecommerce-main-image', 'sort_order' => 30],
            ['name' => '品牌视觉', 'slug' => 'brand-visual', 'sort_order' => 40],
            ['name' => '社媒配图', 'slug' => 'social-media', 'sort_order' => 50],
            ['name' => '国潮插画', 'slug' => 'chinese-style-illustration', 'sort_order' => 60],
            ['name' => '写实场景', 'slug' => 'realistic-scene', 'sort_order' => 70],
            ['name' => '室内空间', 'slug' => 'interior-space', 'sort_order' => 80],
            ['name' => '建筑景观', 'slug' => 'architecture-landscape', 'sort_order' => 90],
            ['name' => 'IP 角色', 'slug' => 'ip-character', 'sort_order' => 100],
            ['name' => '字体海报', 'slug' => 'typography-poster', 'sort_order' => 110],
            ['name' => '包装设计', 'slug' => 'packaging-design', 'sort_order' => 120],
            ['name' => '节日营销', 'slug' => 'festival-marketing', 'sort_order' => 130],
            ['name' => '通用模板', 'slug' => 'general-template', 'sort_order' => 999],
        ];

        $now = now();
        foreach ($items as $item) {
            DB::table('shared_creative_template_categories')->updateOrInsert(
                ['slug' => $item['slug']],
                [
                    'name' => $item['name'],
                    'sort_order' => $item['sort_order'],
                    'updated_at' => $now,
                    'created_at' => $now,
                ]
            );
        }
    }
}
