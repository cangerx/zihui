<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\SiteUpdateRelease;
use App\Services\ReleaseDraft\LocalReleaseDraftStore;
use App\Services\SiteUpdate\SiteUpdateFeedService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;

class SiteUpdateReleaseController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $channel = (string) $request->query('channel', SiteUpdateRelease::CHANNEL_ADMIN);
        $rows = SiteUpdateRelease::query()
            ->where('channel', $channel)
            ->orderByDesc('id')
            ->get();

        return response()->json(['items' => $rows], 200);
    }

    public function draft(LocalReleaseDraftStore $store): JsonResponse
    {
        return response()->json(['draft' => $store->readCloudAdmin()], 200);
    }

    public function store(Request $request, SiteUpdateFeedService $feed): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'channel' => ['nullable', 'in:admin'],
            'version' => ['required', 'string', 'regex:/^\d+\.\d+\.\d+$/', 'max:20'],
            'changelog' => ['nullable', 'string', 'max:8000'],
            'min_upgradable_from' => ['nullable', 'string', 'max:20'],
            'breaking' => ['nullable', 'boolean'],
            'zip_url' => ['nullable', 'url', 'max:500'],
            'sha256' => ['nullable', 'regex:/^[a-fA-F0-9]{64}$/'],
            'zip' => ['nullable', 'file', 'mimes:zip', 'max:512000'],
            'activate' => ['nullable', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $channel = (string) ($request->input('channel') ?: SiteUpdateRelease::CHANNEL_ADMIN);
        $version = (string) $request->input('version');
        if (SiteUpdateRelease::query()->where('channel', $channel)->where('version', $version)->exists()) {
            return response()->json(['error' => 'version_exists'], 409);
        }

        $zipPath = null;
        $sha = null;
        $size = 0;
        if ($request->hasFile('zip')) {
            $stored = $request->file('zip')->storeAs(
                'site-updates/' . $channel,
                $version . '.zip',
                'local'
            );
            $zipPath = $stored;
            $abs = Storage::disk('local')->path($stored);
            $size = is_file($abs) ? (int) filesize($abs) : 0;
            $sha = is_file($abs) ? hash_file('sha256', $abs) : null;
        } elseif ($request->filled('sha256')) {
            $sha = strtolower((string) $request->input('sha256'));
        }

        if ($zipPath === null && trim((string) $request->input('zip_url')) === '') {
            return response()->json(['error' => 'zip_or_url_required'], 422);
        }
        if ($sha === null || $sha === '') {
            return response()->json(['error' => 'sha256_required'], 422);
        }

        $row = SiteUpdateRelease::query()->create([
            'channel' => $channel,
            'version' => $version,
            'changelog' => $request->input('changelog'),
            'zip_path' => $zipPath,
            'zip_url' => $request->input('zip_url'),
            'sha256' => $sha,
            'size' => $size,
            'min_upgradable_from' => $request->input('min_upgradable_from'),
            'breaking' => (bool) $request->boolean('breaking'),
            'is_current' => false,
            'released_by' => $request->user()->username ?? 'admin',
            'released_at' => now(),
        ]);

        if ($request->boolean('activate')) {
            $this->activateRow($row);
        }

        return response()->json([
            'item' => $row->fresh(),
            'zip_url' => $feed->zipUrl($row->fresh()),
        ], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $row = SiteUpdateRelease::query()->find($id);
        if ($row === null) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $validator = Validator::make($request->all(), [
            'changelog' => ['sometimes', 'nullable', 'string', 'max:8000'],
            'zip_url' => ['sometimes', 'nullable', 'url', 'max:500'],
            'min_upgradable_from' => ['sometimes', 'nullable', 'string', 'max:20'],
            'breaking' => ['sometimes', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }
        $row->fill($request->only(['changelog', 'zip_url', 'min_upgradable_from', 'breaking']));
        $row->save();

        return response()->json(['item' => $row], 200);
    }

    public function setCurrent(int $id): JsonResponse
    {
        $row = SiteUpdateRelease::query()->find($id);
        if ($row === null) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $this->activateRow($row);

        return response()->json(['item' => $row->fresh(), 'status' => 'ok'], 200);
    }

    public function destroy(int $id): JsonResponse
    {
        $row = SiteUpdateRelease::query()->find($id);
        if ($row === null) {
            return response()->json(['error' => 'not_found'], 404);
        }
        if ($row->is_current) {
            return response()->json(['error' => 'cannot_delete_current'], 409);
        }
        if ($row->zip_path) {
            Storage::disk('local')->delete($row->zip_path);
        }
        $row->delete();

        return response()->json(['status' => 'ok'], 200);
    }

    private function activateRow(SiteUpdateRelease $row): void
    {
        SiteUpdateRelease::query()->where('channel', $row->channel)->update(['is_current' => false]);
        $row->is_current = true;
        $row->save();
    }
}
