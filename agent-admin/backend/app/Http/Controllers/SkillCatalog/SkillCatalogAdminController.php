<?php

namespace App\Http\Controllers\SkillCatalog;

use App\Http\Controllers\Controller;
use App\Services\SkillCatalog\SkillCatalogService;
use App\Services\SkillCatalog\SkillCatalogSyncService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use InvalidArgumentException;

class SkillCatalogAdminController extends Controller
{
    public function __construct(
        private SkillCatalogService $catalog,
        private SkillCatalogSyncService $sync,
    ) {
    }

    public function index(): JsonResponse
    {
        return response()->json($this->catalog->adminIndex());
    }

    public function show(string $skillId): JsonResponse
    {
        $row = $this->catalog->adminShow($skillId);
        if ($row === null) {
            return response()->json(['error' => 'skill_not_found'], 404);
        }
        return response()->json($row);
    }

    public function update(Request $request, string $skillId): JsonResponse
    {
        $patch = [];
        if ($request->exists('category')) {
            $patch['category'] = (string) $request->input('category');
        }
        if ($request->exists('recommended')) {
            $patch['recommended'] = (bool) $request->input('recommended');
        }
        if ($request->exists('listed')) {
            $patch['listed'] = (bool) $request->input('listed');
        }
        if ($request->exists('status')) {
            $patch['status'] = (string) $request->input('status');
        }
        try {
            $this->catalog->updateSkill($skillId, $patch, 0);
        } catch (InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], $e->getMessage() === 'skill_not_found' ? 404 : 409);
        }
        return response()->json($this->catalog->adminShow($skillId));
    }

    public function setTenantPolicy(Request $request, string $skillId, int $tenantId): JsonResponse
    {
        try {
            $row = $this->catalog->setListed($skillId, $tenantId, (bool) $request->input('listed', true));
        } catch (InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 404);
        }
        return response()->json($row);
    }

    public function sync(): JsonResponse
    {
        $result = $this->sync->sync();
        return response()->json($result, $result['ok'] ? 200 : 409);
    }
}
