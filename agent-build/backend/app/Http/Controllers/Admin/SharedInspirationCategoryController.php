<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/**
 * 共享灵感库 - 分类 CRUD（auth:sanctum）。
 *
 * - 14 个默认分类由 SharedInspirationCategorySeeder 写入
 * - slug 改动需谨慎：云控端可能用 slug 做本地映射缓存（虽然当前 v3 没有 hub_slug 字段，
 *   但保留前向兼容空间）；后台 UI 改 slug 时给二次确认弹窗
 * - 删除前校验：还有灵感引用的分类不允许删（外键 ON DELETE RESTRICT 会自动拦截，
 *   这里软校验给出更友好的错误）
 */
class SharedInspirationCategoryController extends Controller
{
    /** GET /admin/api/shared-inspiration-categories */
    public function index(): JsonResponse
    {
        $rows = DB::table('shared_inspiration_categories as c')
            ->leftJoin('shared_inspirations as s', 'c.id', '=', 's.category_id')
            ->groupBy('c.id', 'c.name', 'c.slug', 'c.sort_order', 'c.created_at', 'c.updated_at')
            ->orderBy('c.sort_order')
            ->orderBy('c.id')
            ->get([
                'c.id', 'c.name', 'c.slug', 'c.sort_order', 'c.created_at', 'c.updated_at',
                DB::raw('COUNT(s.id) as inspiration_count'),
            ]);

        return response()->json(['data' => $rows]);
    }

    /** POST /admin/api/shared-inspiration-categories */
    public function store(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'name'       => ['required', 'string', 'max:50'],
            'slug'       => ['required', 'string', 'max:50', 'regex:/^[a-z0-9][a-z0-9-]*$/'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $slug = $request->input('slug');
        if (DB::table('shared_inspiration_categories')->where('slug', $slug)->exists()) {
            return response()->json(['error' => 'slug_taken', 'slug' => $slug], 409);
        }

        $now = now();
        $id = DB::table('shared_inspiration_categories')->insertGetId([
            'name'       => $request->input('name'),
            'slug'       => $slug,
            'sort_order' => (int) $request->input('sort_order', 0),
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return response()->json(['id' => $id, 'slug' => $slug], 201);
    }

    /** PATCH /admin/api/shared-inspiration-categories/{id} */
    public function update(Request $request, int $id): JsonResponse
    {
        $row = DB::table('shared_inspiration_categories')->where('id', $id)->first();
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $validator = Validator::make($request->all(), [
            'name'       => ['sometimes', 'string', 'max:50'],
            'slug'       => ['sometimes', 'string', 'max:50', 'regex:/^[a-z0-9][a-z0-9-]*$/'],
            'sort_order' => ['sometimes', 'integer', 'min:0'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $update = ['updated_at' => now()];
        if ($request->has('name')) {
            $update['name'] = $request->input('name');
        }
        if ($request->has('slug')) {
            $newSlug = $request->input('slug');
            if ($newSlug !== $row->slug) {
                $clash = DB::table('shared_inspiration_categories')
                    ->where('slug', $newSlug)
                    ->where('id', '!=', $id)
                    ->exists();
                if ($clash) {
                    return response()->json(['error' => 'slug_taken', 'slug' => $newSlug], 409);
                }
                $update['slug'] = $newSlug;
            }
        }
        if ($request->has('sort_order')) {
            $update['sort_order'] = (int) $request->input('sort_order');
        }

        DB::table('shared_inspiration_categories')->where('id', $id)->update($update);
        return response()->json(['ok' => true]);
    }

    /** DELETE /admin/api/shared-inspiration-categories/{id} */
    public function destroy(int $id): JsonResponse
    {
        $row = DB::table('shared_inspiration_categories')->where('id', $id)->first();
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $inspirationCount = DB::table('shared_inspirations')->where('category_id', $id)->count();
        if ($inspirationCount > 0) {
            return response()->json([
                'error' => 'category_in_use',
                'inspiration_count' => $inspirationCount,
                'message' => '该分类下还有灵感，无法删除。请先迁移或删除这些灵感',
            ], 409);
        }

        DB::table('shared_inspiration_categories')->where('id', $id)->delete();
        return response()->json(['ok' => true]);
    }
}
