<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\SkillRegistryReport;
use App\Models\SkillRegistrySkill;
use App\Models\SkillRegistryVersion;
use App\Services\SkillRegistry\SkillRegistryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use InvalidArgumentException;

class SkillRegistryController extends Controller
{
    public function __construct(private SkillRegistryService $registry)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $status = (string) $request->query('status', '');
        $q = SkillRegistrySkill::query()->orderByDesc('id');
        if ($status !== '') {
            $q->where('status', $status);
        }
        $items = $q->limit(200)->get();
        return response()->json(['data' => $items, 'next_cursor' => null, 'has_more' => false]);
    }

    public function pending(): JsonResponse
    {
        $items = SkillRegistryVersion::query()
            ->where('status', 'pending_review')
            ->orderByDesc('id')
            ->limit(200)
            ->get()
            ->map(fn ($row) => $this->versionPayload($row));
        return response()->json(['data' => $items, 'next_cursor' => null, 'has_more' => false]);
    }

    public function show(string $skillId): JsonResponse
    {
        $skill = SkillRegistrySkill::query()->where('skill_id', $skillId)->first();
        if ($skill === null) {
            return response()->json(['error' => 'skill_not_found'], 404);
        }
        $versions = SkillRegistryVersion::query()->where('skill_id', $skillId)->orderByDesc('id')->get()
            ->map(fn ($row) => $this->versionPayload($row));
        return response()->json(['skill' => $skill, 'versions' => $versions]);
    }

    public function upload(Request $request): JsonResponse
    {
        $file = $request->file('package');
        if ($file === null || !$file->isValid()) {
            return response()->json(['error' => 'package_unsafe'], 422);
        }
        $result = $this->registry->upload($file->getRealPath(), optional($request->user())->id);
        if (!$result['ok']) {
            return response()->json(['error' => $result['error']], 422);
        }
        return response()->json([
            'skill_id' => $result['skill']->skill_id,
            'version_id' => $result['version']->version_id,
            'status' => $result['version']->status,
        ], 201);
    }

    public function review(Request $request, string $versionId): JsonResponse
    {
        $action = (string) $request->input('action', '');
        $evidence = (string) $request->input('evidence', '');
        try {
            $version = $this->registry->review($versionId, $action, optional($request->user())->id, $evidence);
        } catch (InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 409);
        }
        return response()->json($this->versionPayload($version));
    }

    public function revoke(Request $request, string $versionId): JsonResponse
    {
        try {
            $version = $this->registry->revoke($versionId, optional($request->user())->id, (string) $request->input('evidence', ''));
        } catch (InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 409);
        }
        return response()->json($this->versionPayload($version));
    }

    public function reports(): JsonResponse
    {
        $items = SkillRegistryReport::query()->orderByDesc('id')->limit(200)->get();
        return response()->json(['data' => $items, 'next_cursor' => null, 'has_more' => false]);
    }

    public function report(Request $request, string $skillId): JsonResponse
    {
        if (!SkillRegistrySkill::query()->where('skill_id', $skillId)->exists()) {
            return response()->json(['error' => 'skill_not_found'], 404);
        }
        $row = SkillRegistryReport::query()->create([
            'skill_id' => $skillId,
            'version_id' => $request->input('version_id'),
            'reason' => mb_substr((string) $request->input('reason', ''), 0, 500),
            'reporter' => (string) optional($request->user())->email,
        ]);
        return response()->json($row, 201);
    }

    /**
     * @return array<string, mixed>
     */
    private function versionPayload(SkillRegistryVersion $row): array
    {
        return [
            'version_id' => $row->version_id,
            'skill_id' => $row->skill_id,
            'version' => $row->version,
            'status' => $row->status,
            'sha256' => $row->sha256,
            'permissions' => $row->permissions_json,
            'scan_report' => $row->scan_report,
            'key_id' => $row->key_id,
            'published_at' => optional($row->published_at)->toIso8601String(),
            'reject_reason' => $row->reject_reason,
            'package_size' => $row->package_size,
            'file_count' => $row->file_count,
            'manifest' => $row->manifest_json,
        ];
    }
}
