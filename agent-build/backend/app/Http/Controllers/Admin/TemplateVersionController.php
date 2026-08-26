<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\ReleaseDraft\LocalReleaseDraftStore;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

class TemplateVersionController extends Controller
{
    /** GET /admin/api/templates */
    public function index(Request $request): JsonResponse
    {
        $rows = DB::table('template_versions')
            ->orderByDesc('id')
            ->get();
        return response()->json(['items' => $rows], 200);
    }

    /** GET /admin/api/templates/draft */
    public function draft(LocalReleaseDraftStore $store): JsonResponse
    {
        return response()->json(['draft' => $store->readDesktopTemplate()], 200);
    }

    /** GET /admin/api/templates/{id} */
    public function show(int $id): JsonResponse
    {
        $row = DB::table('template_versions')->where('id', $id)->first();
        if (!$row) {
            return response()->json(['error' => 'template_not_found'], 404);
        }
        return response()->json($row, 200);
    }

    /** POST /admin/api/templates */
    public function store(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'version' => ['required', 'string', 'regex:/^\d+\.\d+\.\d+$/', 'max:20'],
            'changelog' => ['nullable', 'string', 'max:5000'],
            'released_by' => ['nullable', 'string', 'max:50'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        if (DB::table('template_versions')->where('version', $request->input('version'))->exists()) {
            return response()->json(['error' => 'version_exists'], 409);
        }

        $now = now();
        $authUser = $request->user();
        $releasedBy = $request->input('released_by') ?: ($authUser->username ?? 'system');

        $id = DB::table('template_versions')->insertGetId([
            'version' => $request->input('version'),
            'changelog' => $request->input('changelog'),
            'released_at' => $now,
            'released_by' => $releasedBy,
            'is_current' => 0,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return response()->json(['id' => $id, 'version' => $request->input('version')], 201);
    }

    /** PATCH /admin/api/templates/{id} */
    public function update(Request $request, int $id): JsonResponse
    {
        $row = DB::table('template_versions')->where('id', $id)->first();
        if (!$row) {
            return response()->json(['error' => 'template_not_found'], 404);
        }

        $validator = Validator::make($request->all(), [
            'changelog' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'released_by' => ['sometimes', 'nullable', 'string', 'max:50'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $update = ['updated_at' => now()];
        foreach (['changelog', 'released_by'] as $k) {
            if ($request->has($k)) {
                $update[$k] = $request->input($k);
            }
        }
        DB::table('template_versions')->where('id', $id)->update($update);
        return response()->json(['status' => 'updated'], 200);
    }

    /** DELETE /admin/api/templates/{id} */
    public function destroy(int $id): JsonResponse
    {
        $row = DB::table('template_versions')->where('id', $id)->first();
        if (!$row) {
            return response()->json(['error' => 'template_not_found'], 404);
        }
        if ($row->is_current) {
            return response()->json(['error' => 'cannot_delete_current_version'], 409);
        }
        DB::table('template_versions')->where('id', $id)->delete();
        return response()->json(['status' => 'deleted'], 200);
    }

    /** POST /admin/api/templates/{id}/set-current */
    public function setCurrent(int $id): JsonResponse
    {
        $row = DB::table('template_versions')->where('id', $id)->first();
        if (!$row) {
            return response()->json(['error' => 'template_not_found'], 404);
        }

        DB::transaction(function () use ($id) {
            DB::table('template_versions')->where('is_current', 1)->update([
                'is_current' => 0,
                'updated_at' => now(),
            ]);
            DB::table('template_versions')->where('id', $id)->update([
                'is_current' => 1,
                'updated_at' => now(),
            ]);
        });

        return response()->json(['status' => 'set_as_current', 'id' => $id, 'version' => $row->version], 200);
    }
}
