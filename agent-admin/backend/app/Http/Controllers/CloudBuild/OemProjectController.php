<?php

namespace App\Http\Controllers\CloudBuild;

use App\Http\Controllers\Controller;
use App\Services\CloudBuild\CloudBuildBackend;
use App\Services\CloudBuild\CloudBuildIconValidator;
use App\Services\CloudBuild\CloudBuildProjectionSynchronizer;
use App\Services\CloudBuild\OemBuildPullService;
use App\Services\CloudBuild\UpdateDirService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

class OemProjectController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $page = max(1, (int) $request->query('page', 1));
        $pageSize = min(100, max(1, (int) $request->query('page_size', 20)));
        $status = (string) $request->query('status', '');
        $keyword = trim((string) $request->query('keyword', ''));

        $q = DB::table('oem_projects')->whereNull('deleted_at');
        if ($status !== '') {
            $q->where('status', $status);
        }
        if ($keyword !== '') {
            $q->where(function ($qq) use ($keyword) {
                $qq->where('project_key', 'like', "%{$keyword}%")
                    ->orWhere('name', 'like', "%{$keyword}%")
                    ->orWhere('app_name', 'like', "%{$keyword}%")
                    ->orWhere('app_id', 'like', "%{$keyword}%");
            });
        }

        $total = (clone $q)->count();
        $rows = $q->orderByDesc('created_at')
            ->skip(($page - 1) * $pageSize)
            ->take($pageSize)
            ->get();

        $keys = $rows->pluck('project_key')->all();
        $latest = empty($keys) ? collect() : DB::table('oem_builds')
            ->select('project_key', DB::raw('MAX(created_at) as latest_created_at'), DB::raw('COUNT(*) as build_count'))
            ->whereIn('project_key', $keys)
            ->groupBy('project_key')
            ->get()
            ->keyBy('project_key');
        $memberCounts = empty($keys) ? collect() : DB::table('oem_project_members')
            ->select('oem_project_key', DB::raw('COUNT(*) as member_count'))
            ->whereIn('oem_project_key', $keys)
            ->where('status', 'active')
            ->groupBy('oem_project_key')
            ->get()
            ->keyBy('oem_project_key');

        $items = $rows->map(function ($row) use ($latest, $memberCounts) {
            $meta = $latest->get($row->project_key);
            $memberMeta = $memberCounts->get($row->project_key);
            $row->build_count = $meta ? (int) $meta->build_count : 0;
            $row->member_count = $memberMeta ? (int) $memberMeta->member_count : 0;
            $row->latest_build_created_at = $meta ? $meta->latest_created_at : null;
            return $row;
        })->values();

        return response()->json([
            'total' => $total,
            'page' => $page,
            'page_size' => $pageSize,
            'items' => $items,
        ], 200);
    }

    public function store(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'name' => ['required', 'string', 'max:50'],
            'app_name' => ['nullable', 'string', 'max:50'],
            'icon_url' => ['nullable', 'url', 'max:500'],
            'app_id' => ['nullable', 'string', 'max:160', 'regex:/^[A-Za-z0-9][A-Za-z0-9_.-]{2,150}$/'],
            'status' => ['nullable', 'in:active,disabled,archived'],
            'commission_rate' => ['nullable', 'numeric', 'min:0', 'max:1'],
            'commission_enabled' => ['nullable', 'boolean'],
            'customer_service_title' => ['nullable', 'string', 'max:50'],
            'customer_service_image_url' => ['nullable', 'url', 'max:500'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        // 图标必须是合规 PNG（手动填写的 URL 也走同一把关，防止非 PNG 流入打包链路）
        $iconUrlInput = trim((string) ($request->input('icon_url') ?: ''));
        if ($iconUrlInput !== '') {
            $iconError = CloudBuildIconValidator::validateUrl($iconUrlInput);
            if ($iconError !== null) {
                return response()->json(['error' => 'invalid_icon', 'message' => $iconError], 422);
            }
        }

        $inputAppId = trim((string) ($request->input('app_id') ?: ''));
        if ($inputAppId !== '' && str_contains($inputAppId, '..')) {
            return response()->json(['error' => 'validation_failed', 'details' => ['app_id' => ['app_id must not contain consecutive dots']]], 422);
        }
        if ($inputAppId !== '' && DB::table('oem_projects')->where('app_id', $inputAppId)->exists()) {
            return response()->json(['error' => 'oem_project_conflict'], 409);
        }
        $name = trim((string) $request->input('name'));
        $appName = trim((string) ($request->input('app_name') ?: ''));
        if ($appName === '') {
            $appName = $name;
        }

        try {
            $project = DB::transaction(function () use ($request, $inputAppId, $name, $appName) {
                $now = now();
                $seed = strtolower(bin2hex(random_bytes(8)));
                $tmpKey = 'pending-' . $seed;
                $tmpAppId = $inputAppId !== '' ? $inputAppId : 'com.localagent.oem.pending.' . $seed;

                $id = DB::table('oem_projects')->insertGetId([
                    'project_key' => $tmpKey,
                    'name' => $name,
                    'app_name' => $appName,
                    'icon_url' => $request->input('icon_url'),
                    'app_id' => $tmpAppId,
                    'update_path' => $this->updatePath($tmpKey),
                    'current_version' => null,
                    'status' => (string) $request->input('status', 'active'),
                    'commission_rate' => (float) $request->input('commission_rate', 0),
                    'commission_enabled' => $request->has('commission_enabled') ? (bool) $request->boolean('commission_enabled') : true,
                    'customer_service_title' => $request->input('customer_service_title'),
                    'customer_service_image_url' => $request->input('customer_service_image_url'),
                    'created_by_user_id' => optional(auth()->user())->id,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);

                $projectKey = null;
                $appId = null;
                $updatePath = null;
                for ($attempt = 0; $attempt < 20; $attempt++) {
                    $candidateKey = $this->generatedProjectKey((int) $id, $attempt);
                    $candidateAppId = $inputAppId !== '' ? $inputAppId : $this->defaultAppId($candidateKey);
                    $candidateUpdatePath = $this->updatePath($candidateKey);
                    $exists = DB::table('oem_projects')
                        ->where('id', '<>', $id)
                        ->where(function ($q) use ($candidateKey, $candidateAppId, $candidateUpdatePath) {
                            $q->where('project_key', $candidateKey)
                                ->orWhere('app_id', $candidateAppId)
                                ->orWhere('update_path', $candidateUpdatePath);
                        })
                        ->exists();
                    if (!$exists) {
                        $projectKey = $candidateKey;
                        $appId = $candidateAppId;
                        $updatePath = $candidateUpdatePath;
                        break;
                    }
                }
                if (!$projectKey || !$appId || !$updatePath) {
                    throw new \RuntimeException('oem_project_conflict');
                }

                DB::table('oem_projects')->where('id', $id)->update([
                    'project_key' => $projectKey,
                    'app_id' => $appId,
                    'update_path' => $updatePath,
                    'updated_at' => $now,
                ]);

                return DB::table('oem_projects')->where('id', $id)->first();
            });
        } catch (\RuntimeException $e) {
            if ($e->getMessage() === 'oem_project_conflict') {
                return response()->json(['error' => 'oem_project_conflict'], 409);
            }
            throw $e;
        }

        return response()->json(['project' => $project], 201);
    }

    public function show(string $projectKey): JsonResponse
    {
        $project = $this->findProject($projectKey);
        if (!$project) {
            return response()->json(['error' => 'oem_project_not_found'], 404);
        }

        $recentBuilds = DB::table('oem_builds')
            ->where('project_key', $projectKey)
            ->orderByDesc('created_at')
            ->limit(10)
            ->get();
        $members = $this->projectMembers($projectKey);

        return response()->json([
            'project' => $project,
            'recent_builds' => $recentBuilds,
            'members' => $members,
        ], 200);
    }

    public function update(Request $request, string $projectKey): JsonResponse
    {
        $project = $this->findProject($projectKey);
        if (!$project) {
            return response()->json(['error' => 'oem_project_not_found'], 404);
        }

        $validator = Validator::make($request->all(), [
            'name' => ['nullable', 'string', 'max:100'],
            'app_name' => ['nullable', 'string', 'max:50'],
            'icon_url' => ['nullable', 'url', 'max:500'],
            'status' => ['nullable', 'in:active,disabled,archived'],
            'commission_rate' => ['nullable', 'numeric', 'min:0', 'max:1'],
            'commission_enabled' => ['nullable', 'boolean'],
            'customer_service_title' => ['nullable', 'string', 'max:50'],
            'customer_service_image_url' => ['nullable', 'url', 'max:500'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        // 图标若有变更且非空，必须是合规 PNG（清空保存为 null 的情况跳过校验）
        if ($request->has('icon_url')) {
            $iconUrlInput = trim((string) $request->input('icon_url'));
            if ($iconUrlInput !== '') {
                $iconError = CloudBuildIconValidator::validateUrl($iconUrlInput);
                if ($iconError !== null) {
                    return response()->json(['error' => 'invalid_icon', 'message' => $iconError], 422);
                }
            }
        }

        $update = ['updated_at' => now()];
        foreach (['name', 'app_name', 'icon_url', 'status', 'commission_rate', 'customer_service_title', 'customer_service_image_url'] as $field) {
            if ($request->has($field)) {
                $value = $request->input($field);
                if (in_array($field, ['icon_url', 'customer_service_image_url'], true) && $value === '') {
                    $value = null;
                }
                $update[$field] = $value;
            }
        }
        if ($request->has('commission_enabled')) {
            $update['commission_enabled'] = (bool) $request->boolean('commission_enabled');
        }
        DB::table('oem_projects')->where('id', $project->id)->update($update);

        return response()->json(['project' => $this->findProject($projectKey)], 200);
    }

    public function destroy(string $projectKey): JsonResponse
    {
        $project = $this->findProject($projectKey);
        if (!$project) {
            return response()->json(['error' => 'oem_project_not_found'], 404);
        }

        $activeBuild = DB::table('oem_builds')
            ->where('project_key', $projectKey)
            ->whereIn('status', ['queued', 'building', 'success', 'downloading'])
            ->exists();
        if ($activeBuild) {
            return response()->json(['error' => 'project_has_active_builds'], 409);
        }

        DB::table('oem_projects')->where('id', $project->id)->update([
            'status' => 'archived',
            'deleted_at' => now(),
            'updated_at' => now(),
        ]);

        return response()->json(['status' => 'deleted'], 200);
    }

    public function members(string $projectKey): JsonResponse
    {
        if (!$this->findProject($projectKey)) {
            return response()->json(['error' => 'oem_project_not_found'], 404);
        }
        return response()->json(['members' => $this->projectMembers($projectKey)], 200);
    }

    public function upsertMember(Request $request, string $projectKey): JsonResponse
    {
        if (!$this->findProject($projectKey)) {
            return response()->json(['error' => 'oem_project_not_found'], 404);
        }
        $validator = Validator::make($request->all(), [
            'user_id' => ['required', 'integer', 'exists:users,id'],
            'role' => ['nullable', 'in:owner,manager'],
            'status' => ['nullable', 'in:active,disabled'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }
        $now = now();
        DB::table('oem_project_members')->updateOrInsert(
            ['oem_project_key' => $projectKey, 'user_id' => (int) $request->input('user_id')],
            [
                'role' => (string) $request->input('role', 'owner'),
                'status' => (string) $request->input('status', 'active'),
                'updated_at' => $now,
                'created_at' => $now,
            ]
        );
        return response()->json(['members' => $this->projectMembers($projectKey)], 200);
    }

    public function syncMembers(Request $request, string $projectKey): JsonResponse
    {
        if (!$this->findProject($projectKey)) {
            return response()->json(['error' => 'oem_project_not_found'], 404);
        }
        $validator = Validator::make($request->all(), [
            'members' => ['present', 'array'],
            'members.*.user_id' => ['required', 'integer', 'exists:users,id'],
            'members.*.role' => ['nullable', 'in:owner,manager'],
            'members.*.status' => ['nullable', 'in:active,disabled'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }
        DB::transaction(function () use ($request, $projectKey) {
            DB::table('oem_project_members')->where('oem_project_key', $projectKey)->delete();
            $now = now();
            $seen = [];
            foreach ((array) $request->input('members', []) as $member) {
                $userId = (int) $member['user_id'];
                if (isset($seen[$userId])) {
                    continue;
                }
                $seen[$userId] = true;
                DB::table('oem_project_members')->insert([
                    'oem_project_key' => $projectKey,
                    'user_id' => $userId,
                    'role' => (string) ($member['role'] ?? 'owner'),
                    'status' => (string) ($member['status'] ?? 'active'),
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        });
        return response()->json(['members' => $this->projectMembers($projectKey)], 200);
    }

    public function deleteMember(string $projectKey, int $userId): JsonResponse
    {
        if (!$this->findProject($projectKey)) {
            return response()->json(['error' => 'oem_project_not_found'], 404);
        }
        DB::table('oem_project_members')
            ->where('oem_project_key', $projectKey)
            ->where('user_id', $userId)
            ->delete();
        return response()->json(['members' => $this->projectMembers($projectKey)], 200);
    }

    public function builds(Request $request, string $projectKey): JsonResponse
    {
        $project = $this->findProject($projectKey);
        if (!$project) {
            return response()->json(['error' => 'oem_project_not_found'], 404);
        }

        $page = max(1, (int) $request->query('page', 1));
        $pageSize = min(100, max(1, (int) $request->query('page_size', 20)));
        $q = DB::table('oem_builds')->where('project_key', $projectKey);
        if ($s = $request->query('status')) $q->where('status', $s);
        if ($p = $request->query('platform')) $q->where('platform', $p);

        $total = (clone $q)->count();
        $rows = $q->orderByDesc('created_at')
            ->skip(($page - 1) * $pageSize)
            ->take($pageSize)
            ->get();

        $sync = app(CloudBuildProjectionSynchronizer::class);
        foreach ($rows as $row) {
            if (in_array((string) $row->status, ['queued', 'building', 'success', 'downloading'], true)) {
                $sync->syncByBuildId((string) $row->build_id);
            }
        }
        $ids = $rows->pluck('id')->filter()->all();
        if ($ids !== []) {
            $fresh = DB::table('oem_builds')->whereIn('id', $ids)->get()->keyBy('id');
            $rows = $rows->map(fn ($row) => $fresh->get($row->id) ?? $row);
        }

        return response()->json([
            'project' => $project,
            'total' => $total,
            'page' => $page,
            'page_size' => $pageSize,
            'items' => $rows->values(),
        ], 200);
    }

    public function requestBuild(Request $request, string $projectKey, CloudBuildBackend $backend): JsonResponse
    {
        $project = $this->findProject($projectKey);
        if (!$project) {
            return response()->json(['error' => 'oem_project_not_found'], 404);
        }
        if ($project->status !== 'active') {
            return response()->json(['error' => 'oem_project_not_active'], 409);
        }

        $validator = Validator::make($request->all(), [
            'platform' => ['required', 'in:win,mac'],
            'app_name' => ['nullable', 'string', 'max:50'],
            'icon_url' => ['nullable', 'url', 'max:500'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }
        if (!$backend->isConfigured()) {
            return response()->json(['error' => 'agent_build_not_configured'], 503);
        }

        $activeBuild = DB::table('oem_builds')
            ->where('project_key', $projectKey)
            ->whereIn('status', ['queued', 'building', 'success', 'downloading'])
            ->first();
        if ($activeBuild) {
            return response()->json(['error' => 'project_busy', 'build_id' => $activeBuild->build_id, 'status' => $activeBuild->status], 409);
        }

        $platform = (string) $request->input('platform');
        $deny = \App\Services\CloudBuild\PackagingLicense::denyReason($platform);
        if ($deny !== null) {
            return response()->json(['error' => $deny], 403);
        }
        $appName = (string) ($request->input('app_name') ?: $project->app_name);
        $iconUrl = (string) ($request->input('icon_url') ?: $project->icon_url);
        if ($iconUrl === '') {
            return response()->json(['error' => 'icon_required'], 422);
        }
        // 打包前同步把关：图标必须是合规 PNG，否则立即返回明确错误，
        // 不再浪费 GitHub Actions 配额、也不再让用户在 CI 里看到晦涩的 magic mismatch
        $iconError = CloudBuildIconValidator::validateUrl($iconUrl);
        if ($iconError !== null) {
            return response()->json(['error' => 'invalid_icon', 'message' => $iconError], 422);
        }

        $resp = $backend->requestOemBuild(
            $appName,
            $platform,
            $iconUrl,
            $project->project_key,
            $project->app_id,
            $project->update_path,
            null,
            [
                'build_mode' => 'oem',
                'oem_project_key' => $project->project_key,
                'app_id' => $project->app_id,
                'update_path' => $project->update_path,
            ]
        );
        $status = (int) ($resp['_status'] ?? 0);
        if ($status !== 200) {
            $http = in_array($status, [403, 409, 422, 429, 503], true) ? $status : 502;
            return response()->json([
                'error' => 'agent_build_rejected',
                'agent_build_status' => $status,
                'agent_build_response' => $resp,
            ], $http);
        }

        $buildId = $resp['build_id'] ?? null;
        if (!$buildId) {
            return response()->json(['error' => 'malformed_agent_build_response', 'response' => $resp], 502);
        }
        $appVersion = (string) ($resp['app_version'] ?? '0.0.0');

        $now = now();
        DB::table('oem_builds')->insert([
            'oem_project_id' => $project->id,
            'project_key' => $project->project_key,
            'build_id' => $buildId,
            'platform' => $platform,
            'app_name' => $appName,
            'app_version' => $appVersion,
            'icon_url' => $iconUrl,
            'app_id' => $project->app_id,
            'update_path' => $project->update_path,
            'status' => 'queued',
            'requested_by_user_id' => optional(auth()->user())->id,
            'queued_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $build = DB::table('oem_builds')->where('build_id', $buildId)->first();
        return response()->json([
            'build_id' => $buildId,
            'status' => 'queued',
            'app_version' => $appVersion,
            'estimated_wait_seconds' => $resp['estimated_wait_seconds'] ?? 0,
            'build' => $build,
        ], 200);
    }

    public function showBuild(string $projectKey, string $buildId, CloudBuildBackend $backend): JsonResponse
    {
        $build = $this->findBuild($projectKey, $buildId);
        if (!$build) {
            return response()->json(['error' => 'oem_build_not_found'], 404);
        }
        $remote = $this->syncRemoteStatus($build, $backend);
        $build = $this->findBuild($projectKey, $buildId);
        return response()->json(['build' => $build, 'remote' => $remote], 200);
    }

    public function refreshBuild(string $projectKey, string $buildId, OemBuildPullService $service): JsonResponse
    {
        if (!$this->findProject($projectKey)) {
            return response()->json(['error' => 'oem_project_not_found'], 404);
        }
        if (!$this->findBuild($projectKey, $buildId)) {
            return response()->json(['error' => 'oem_build_not_found'], 404);
        }
        $r = $service->pullOne($buildId);
        return response()->json([
            'outcome' => $r['outcome'],
            'message' => $r['message'],
            'build' => $r['row'],
        ], $r['outcome'] === 'not_found' ? 404 : 200);
    }

    public function retryBuild(string $projectKey, string $buildId, OemBuildPullService $service): JsonResponse
    {
        $build = $this->findBuild($projectKey, $buildId);
        if (!$build) {
            return response()->json(['error' => 'oem_build_not_found'], 404);
        }
        if (!in_array($build->status, ['failed', 'expired', 'cancelled'], true)) {
            return response()->json(['error' => 'not_retryable', 'current_status' => $build->status], 409);
        }

        $r = $service->retryOne($buildId);
        return response()->json([
            'outcome' => $r['outcome'],
            'message' => $r['message'],
            'build' => $r['row'],
        ], 200);
    }

    public function cancelBuild(string $projectKey, string $buildId, Request $request, CloudBuildBackend $backend): JsonResponse
    {
        $build = $this->findBuild($projectKey, $buildId);
        if (!$build) {
            return response()->json(['error' => 'oem_build_not_found'], 404);
        }
        if (!in_array($build->status, ['queued', 'building'], true)) {
            return response()->json(['error' => 'not_cancellable', 'current_status' => $build->status], 409);
        }

        $force = $request->boolean('force', false);
        $resp = $backend->cancel($buildId, $force);
        if (!$force) {
            $status = (int) ($resp['_status'] ?? 0);
            if ($status !== 200 && $status !== 404) {
                return response()->json([
                    'error' => 'agent_build_cancel_failed',
                    'agent_build_status' => $status,
                    'agent_build_response' => $resp,
                ], 502);
            }
        }

        DB::table('oem_builds')->where('id', $build->id)->update([
            'status' => 'cancelled',
            'error_message' => $force ? '管理员强制取消（未通知打包平台）' : null,
            'finished_at' => now(),
            'updated_at' => now(),
        ]);

        return response()->json(['status' => 'cancelled'], 200);
    }

    public function cleanupInvalid(string $projectKey): JsonResponse
    {
        if (!$this->findProject($projectKey)) {
            return response()->json(['error' => 'oem_project_not_found'], 404);
        }

        $rows = DB::table('oem_builds')
            ->where('project_key', $projectKey)
            ->whereIn('status', ['cancelled', 'failed'])
            ->get(['id', 'stored_path', 'supplementary_files']);

        $filesDeleted = 0;
        $publicBase = public_path();
        $prefix = 'updates/oem/' . $projectKey . '/';
        foreach ($rows as $row) {
            foreach ($this->extractStoredPaths($row) as $path) {
                $filesDeleted += $this->deleteStoredPath($path, $prefix, $publicBase);
            }
        }

        $recordsDeleted = DB::table('oem_builds')
            ->where('project_key', $projectKey)
            ->whereIn('status', ['cancelled', 'failed'])
            ->delete();

        return response()->json([
            'records_deleted' => $recordsDeleted,
            'files_deleted' => $filesDeleted,
        ], 200);
    }

    public function listInstallers(string $projectKey, UpdateDirService $svc): JsonResponse
    {
        $project = $this->findProject($projectKey);
        if (!$project) {
            return response()->json(['error' => 'oem_project_not_found'], 404);
        }

        $base = $svc->updatesBaseDir() . DIRECTORY_SEPARATOR . 'oem' . DIRECTORY_SEPARATOR . $projectKey;
        if (!is_dir($base)) {
            return response()->json([
                'project' => $project,
                'base' => $base,
                'items' => [],
                'total_size' => 0,
            ], 200);
        }

        $linkMap = [];
        foreach (DB::table('oem_builds')->where('project_key', $projectKey)->get(['build_id', 'stored_path', 'supplementary_files', 'app_name', 'app_version']) as $row) {
            if (!empty($row->stored_path)) {
                $linkMap[(string) $row->stored_path] = [
                    'build_id' => $row->build_id,
                    'app_name' => $row->app_name,
                    'app_version' => $row->app_version,
                ];
            }
            foreach ($this->extractStoredPaths($row) as $path) {
                $linkMap[$path] = [
                    'build_id' => $row->build_id,
                    'app_name' => $row->app_name,
                    'app_version' => $row->app_version,
                ];
            }
        }

        $primaries = [];
        $blockmaps = [];
        $totalSize = 0;
        foreach (scandir($base) ?: [] as $f) {
            if ($f === '.' || $f === '..') continue;
            $full = $base . DIRECTORY_SEPARATOR . $f;
            if (!is_file($full)) continue;
            $size = (int) (@filesize($full) ?: 0);
            $totalSize += $size;
            $lower = strtolower($f);
            if (str_ends_with($lower, '.blockmap')) {
                $primaryName = substr($f, 0, -strlen('.blockmap'));
                $blockmaps[$primaryName] = ['filename' => $f, 'size' => $size];
                continue;
            }
            if (str_ends_with($lower, '.exe')) {
                $primaries[$f] = ['size' => $size, 'mtime' => @filemtime($full) ?: 0, 'platform' => 'win'];
                continue;
            }
            if (str_ends_with($lower, '.dmg') || str_ends_with($lower, '.zip')) {
                $primaries[$f] = ['size' => $size, 'mtime' => @filemtime($full) ?: 0, 'platform' => 'mac'];
            }
        }

        $items = [];
        foreach ($primaries as $name => $p) {
            $bm = $blockmaps[$name] ?? null;
            $storedPath = 'updates/oem/' . $projectKey . '/' . $name;
            $items[] = [
                'filename' => $name,
                'stored_path' => $storedPath,
                'platform' => $p['platform'],
                'primary_size' => $p['size'],
                'blockmap_filename' => $bm['filename'] ?? null,
                'blockmap_size' => $bm['size'] ?? 0,
                'size' => $p['size'] + ($bm['size'] ?? 0),
                'mtime' => $p['mtime'] ? date('Y-m-d H:i:s', $p['mtime']) : null,
                'linked_build' => $linkMap[$storedPath] ?? null,
            ];
        }

        usort($items, fn($a, $b) => strcmp((string) $b['mtime'], (string) $a['mtime']));

        return response()->json([
            'project' => $project,
            'base' => $base,
            'items' => $items,
            'total_size' => $totalSize,
        ], 200);
    }

    public function deleteInstaller(Request $request, string $projectKey, UpdateDirService $svc): JsonResponse
    {
        if (!$this->findProject($projectKey)) {
            return response()->json(['error' => 'oem_project_not_found'], 404);
        }

        $filename = (string) $request->query('filename', '');
        if ($filename === '') {
            $filename = (string) $request->input('filename', '');
        }
        $filename = basename($filename);
        if ($filename === '' || !preg_match('/^[A-Za-z0-9._-]+$/', $filename)) {
            return response()->json(['error' => 'invalid_filename'], 422);
        }

        $lower = strtolower($filename);
        if (str_ends_with($lower, '.yml') || str_ends_with($lower, '.yaml')) {
            return response()->json(['error' => 'forbidden_filename', 'message' => '元信息文件禁止删除，误删后桌面端在线更新链路将断裂'], 403);
        }
        if (str_ends_with($lower, '.blockmap')) {
            return response()->json(['error' => 'forbidden_filename', 'message' => 'blockmap 副文件随主安装包一起删除，不允许单独删'], 403);
        }
        if (!str_ends_with($lower, '.exe') && !str_ends_with($lower, '.dmg') && !str_ends_with($lower, '.zip')) {
            return response()->json(['error' => 'forbidden_filename', 'message' => '仅允许删除 .exe / .dmg / .zip 主安装包'], 403);
        }

        $base = $svc->updatesBaseDir() . DIRECTORY_SEPARATOR . 'oem' . DIRECTORY_SEPARATOR . $projectKey;
        $abs = $base . DIRECTORY_SEPARATOR . $filename;
        if (!is_file($abs)) {
            return response()->json(['error' => 'file_not_found', 'filename' => $filename], 404);
        }

        $deleted = [];
        if (!@unlink($abs)) {
            return response()->json(['error' => 'unlink_failed', 'filename' => $filename], 500);
        }
        $deleted[] = $filename;

        $blockmap = $abs . '.blockmap';
        if (is_file($blockmap) && @unlink($blockmap)) {
            $deleted[] = $filename . '.blockmap';
        }

        $storedPath = 'updates/oem/' . $projectKey . '/' . $filename;
        $affected = DB::table('oem_builds')
            ->where('project_key', $projectKey)
            ->where('stored_path', $storedPath)
            ->update([
                'stored_path' => null,
                'updated_at' => now(),
            ]);
        $affected += $this->unlinkSupplementaryStoredPath($projectKey, $storedPath);

        return response()->json([
            'deleted' => $deleted,
            'records_unlinked' => $affected,
        ], 200);
    }

    private function projectMembers(string $projectKey)
    {
        return DB::table('oem_project_members as m')
            ->join('users as u', 'u.id', '=', 'm.user_id')
            ->where('m.oem_project_key', $projectKey)
            ->select([
                'm.user_id',
                'u.username',
                'u.nickname',
                'u.phone',
                'u.email',
                'm.role',
                'm.status',
                'm.created_at',
                'm.updated_at',
            ])
            ->orderByRaw("case m.role when 'owner' then 0 else 1 end")
            ->orderBy('m.id')
            ->get();
    }

    private function findProject(string $projectKey): ?object
    {
        return DB::table('oem_projects')
            ->where('project_key', $projectKey)
            ->whereNull('deleted_at')
            ->first();
    }

    private function findBuild(string $projectKey, string $buildId): ?object
    {
        return DB::table('oem_builds')
            ->where('project_key', $projectKey)
            ->where('build_id', $buildId)
            ->first();
    }

    private function updatePath(string $projectKey): string
    {
        return '/updates/oem/' . $projectKey . '/';
    }

    private function generatedProjectKey(int $id, int $attempt = 0): string
    {
        return $attempt === 0 ? 'oem-' . $id : 'oem-' . $id . '-' . $attempt;
    }

    private function defaultAppId(string $projectKey): string
    {
        return 'com.localagent.oem.' . $projectKey;
    }

    private function extractStoredPaths(object $row): array
    {
        $paths = [];
        if (!empty($row->stored_path)) {
            $paths[] = (string) $row->stored_path;
        }
        $raw = $row->supplementary_files ?? null;
        $list = is_string($raw) ? json_decode($raw, true) : (is_array($raw) ? $raw : []);
        if (is_array($list)) {
            foreach ($list as $sf) {
                if (is_array($sf) && !empty($sf['stored_path'])) {
                    $paths[] = (string) $sf['stored_path'];
                }
            }
        }
        return array_values(array_unique($paths));
    }

    private function deleteStoredPath(string $storedPath, string $requiredPrefix, string $publicBase): int
    {
        $rel = ltrim(str_replace('\\', '/', $storedPath), '/');
        if (str_contains($rel, '..') || !str_starts_with($rel, $requiredPrefix)) {
            return 0;
        }
        $abs = $publicBase . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $rel);
        $deleted = 0;
        if (is_file($abs) && @unlink($abs)) {
            $deleted++;
        }
        $blockmap = $abs . '.blockmap';
        if (is_file($blockmap) && @unlink($blockmap)) {
            $deleted++;
        }
        return $deleted;
    }

    private function unlinkSupplementaryStoredPath(string $projectKey, string $storedPath): int
    {
        $affected = 0;
        $rows = DB::table('oem_builds')
            ->where('project_key', $projectKey)
            ->whereNotNull('supplementary_files')
            ->get(['id', 'supplementary_files']);
        foreach ($rows as $row) {
            $list = is_string($row->supplementary_files) ? json_decode($row->supplementary_files, true) : [];
            if (!is_array($list)) continue;
            $changed = false;
            foreach ($list as &$sf) {
                if (is_array($sf) && (($sf['stored_path'] ?? null) === $storedPath)) {
                    unset($sf['stored_path']);
                    $changed = true;
                }
            }
            unset($sf);
            if ($changed) {
                DB::table('oem_builds')->where('id', $row->id)->update([
                    'supplementary_files' => json_encode($list, JSON_UNESCAPED_SLASHES),
                    'updated_at' => now(),
                ]);
                $affected++;
            }
        }
        return $affected;
    }

    private function syncRemoteStatus(object $local, CloudBuildBackend $backend): ?array
    {
        if (!in_array($local->status, ['queued', 'building', 'success', 'downloading'], true)) {
            return null;
        }
        $remote = $backend->getStatus($local->build_id);
        if (($remote['_status'] ?? 0) === 200 && isset($remote['status'])) {
            $status = (string) $remote['status'];
            if ($status === 'pending') $status = 'queued';
            if ($status !== $local->status && in_array($status, ['queued', 'building', 'success', 'failed', 'cancelled', 'expired'], true)) {
                $update = ['status' => $status, 'updated_at' => now()];
                if ($status === 'building' && !empty($remote['started_at'])) {
                    $update['started_at'] = $remote['started_at'];
                }
                if (in_array($status, ['failed', 'cancelled', 'expired'], true)) {
                    $update['error_message'] = $remote['error_message'] ?? null;
                    $update['finished_at'] = $remote['finished_at'] ?? now();
                }
                DB::table('oem_builds')->where('id', $local->id)->update($update);
            }
        }
        return $remote;
    }
}
