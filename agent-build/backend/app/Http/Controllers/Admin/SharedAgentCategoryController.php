<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

class SharedAgentCategoryController extends Controller
{
    public function index(): JsonResponse
    {
        $rows = DB::table('shared_agent_categories as c')
            ->leftJoin('shared_agents as a', 'c.id', '=', 'a.category_id')
            ->groupBy('c.id', 'c.name', 'c.slug', 'c.sort_order', 'c.created_at', 'c.updated_at')
            ->orderBy('c.sort_order')
            ->orderBy('c.id')
            ->get([
                'c.id', 'c.name', 'c.slug', 'c.sort_order', 'c.created_at', 'c.updated_at',
                DB::raw('COUNT(a.id) as agent_count'),
            ]);

        return response()->json(['data' => $rows]);
    }

    public function store(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'name' => ['required', 'string', 'max:50'],
            'slug' => ['required', 'string', 'max:50', 'regex:/^[a-z0-9][a-z0-9-]*$/'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $slug = (string) $request->input('slug');
        if (DB::table('shared_agent_categories')->where('slug', $slug)->exists()) {
            return response()->json(['error' => 'slug_taken', 'slug' => $slug], 409);
        }

        $now = now();
        $id = DB::table('shared_agent_categories')->insertGetId([
            'name' => (string) $request->input('name'),
            'slug' => $slug,
            'sort_order' => (int) $request->input('sort_order', 0),
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return response()->json(['id' => $id, 'slug' => $slug], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $row = DB::table('shared_agent_categories')->where('id', $id)->first();
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $validator = Validator::make($request->all(), [
            'name' => ['sometimes', 'string', 'max:50'],
            'slug' => ['sometimes', 'string', 'max:50', 'regex:/^[a-z0-9][a-z0-9-]*$/'],
            'sort_order' => ['sometimes', 'integer', 'min:0'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $update = ['updated_at' => now()];
        if ($request->has('name')) {
            $update['name'] = (string) $request->input('name');
        }
        if ($request->has('slug')) {
            $newSlug = (string) $request->input('slug');
            if ($newSlug !== $row->slug) {
                $clash = DB::table('shared_agent_categories')
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

        DB::table('shared_agent_categories')->where('id', $id)->update($update);
        return response()->json(['ok' => true]);
    }

    public function destroy(int $id): JsonResponse
    {
        $row = DB::table('shared_agent_categories')->where('id', $id)->first();
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $agentCount = DB::table('shared_agents')->where('category_id', $id)->count();
        if ($agentCount > 0) {
            return response()->json([
                'error' => 'category_in_use',
                'agent_count' => $agentCount,
                'message' => '该分类下还有智能体，无法删除。请先迁移或删除这些智能体',
            ], 409);
        }

        DB::table('shared_agent_categories')->where('id', $id)->delete();
        return response()->json(['ok' => true]);
    }
}
