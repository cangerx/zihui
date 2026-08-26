<?php

namespace App\Http\Controllers;

use App\Models\StylePreset;
use Illuminate\Http\JsonResponse;

/**
 * 风格预设（公开拉取）：桌面端各生图入口拉取启用中的风格片段。
 * 不需登录（与 /public/creative-templates/* 同约定），只回启用项，字段最小化。
 */
class StylePresetPublicController extends Controller
{
    /** 启用风格的分类列表（按该分类内最小 sort_order 排序） */
    public function categories(): JsonResponse
    {
        $categories = StylePreset::query()
            ->where('is_enabled', true)
            ->where('category', '!=', '')
            ->select('category')
            ->groupBy('category')
            ->orderByRaw('MIN(sort_order) ASC')
            ->pluck('category');

        return response()->json(['data' => $categories]);
    }

    /** 全量启用风格（数量级为几十，不分页，桌面端一次拉全并本地缓存） */
    public function list(): JsonResponse
    {
        $items = StylePreset::query()
            ->where('is_enabled', true)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get(['id', 'name', 'prompt_fragment', 'sample_image', 'category', 'sort_order']);

        return response()->json(['items' => $items]);
    }
}
