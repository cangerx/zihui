<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\Build\ArtifactPurgeService;
use App\Services\Build\GitHubDispatchService;
use App\Services\Build\QuotaService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class BuildAdminRequestController extends Controller
{
    /** GET /admin/api/requests */
    public function index(Request $request): JsonResponse
    {
        $page = max(1, (int) $request->query('page', 1));
        $pageSize = min(100, max(1, (int) $request->query('page_size', 20)));

        // LEFT JOIN authorized_clients 把 domain / owner_name 一并查出来。
        // LEFT 而不是 INNER 是为了兼容：如果授权记录被删除了，打包历史仍要能展示。
        $q = DB::table('build_requests as br')
            ->leftJoin('authorized_clients as ac', 'ac.client_id', '=', 'br.client_id');

        if ($s = $request->query('status')) {
            $q->where('br.status', $s);
        }
        if ($p = $request->query('platform')) {
            $q->where('br.platform', $p);
        }
        if ($c = $request->query('client_id')) {
            $q->where('br.client_id', $c);
        }
        if ($m = $request->query('build_mode')) {
            $q->where('br.build_mode', $m);
        }
        if ($k = $request->query('oem_project_key')) {
            $q->where('br.oem_project_key', $k);
        }
        // 按域名 / 运维姓名关键字模糊搜索（新增）
        if ($kw = (string) $request->query('keyword', '')) {
            $q->where(function ($qq) use ($kw) {
                $qq->where('ac.domain', 'like', "%{$kw}%")
                    ->orWhere('ac.owner_name', 'like', "%{$kw}%");
            });
        }
        if ($df = $request->query('date_from')) {
            $q->where('br.created_at', '>=', $df);
        }
        if ($dt = $request->query('date_to')) {
            $q->where('br.created_at', '<=', $dt);
        }

        $total = (clone $q)->count('br.build_id');
        $rows = $q->orderByDesc('br.created_at')
            ->skip(($page - 1) * $pageSize)
            ->take($pageSize)
            ->get([
                'br.build_id', 'br.client_id', 'br.app_name', 'br.platform', 'br.app_version',
                'br.build_mode', 'br.oem_project_key', 'br.app_id', 'br.update_path',
                'br.status', 'br.executor_id', 'br.executor_run_id',
                'br.mirror_status', 'br.mirror_assigned_at', 'br.mirror_acked_at',
                'br.queued_at', 'br.started_at', 'br.finished_at', 'br.delivered_at', 'br.purged_at',
                'br.error_message', 'br.created_at',
                'ac.domain as domain',
                'ac.owner_name as owner_name',
            ]);

        return response()->json([
            'total' => $total,
            'page' => $page,
            'page_size' => $pageSize,
            'items' => $rows,
        ], 200);
    }

    /** GET /admin/api/requests/{buildId} */
    public function show(string $buildId): JsonResponse
    {
        $build = DB::table('build_requests')->where('build_id', $buildId)->first();
        if (!$build) {
            return response()->json(['error' => 'build_not_found'], 404);
        }
        // 隐藏 callback_token (敏感)
        unset($build->callback_token);
        return response()->json($build, 200);
    }

    /** POST /admin/api/requests/{buildId}/force-cancel */
    public function forceCancel(string $buildId, GitHubDispatchService $github, QuotaService $quota): JsonResponse
    {
        $build = DB::table('build_requests')->where('build_id', $buildId)->first();
        if (!$build) {
            return response()->json(['error' => 'build_not_found'], 404);
        }
        if (in_array($build->status, ['success', 'delivered', 'purged', 'failed', 'expired', 'cancelled'])) {
            return response()->json(['error' => 'not_cancellable', 'current_status' => $build->status], 409);
        }

        if ($build->status === 'building' && $build->executor_run_id) {
            $github->cancelRun((int) $build->executor_run_id);
        }

        DB::table('build_requests')->where('build_id', $buildId)->update([
            'status' => 'cancelled',
            'finished_at' => now(),
            'error_message' => 'admin_force_cancelled',
            'callback_token' => null,
            'updated_at' => now(),
        ]);

        $quota->decrDailyCount($build->client_id, date('Y-m-d', strtotime($build->created_at)));

        return response()->json(['status' => 'cancelled', 'quota_refunded' => true], 200);
    }

    /** POST /admin/api/requests/{buildId}/retry */
    public function retry(string $buildId, QuotaService $quota): JsonResponse
    {
        $orig = DB::table('build_requests')->where('build_id', $buildId)->first();
        if (!$orig) {
            return response()->json(['error' => 'build_not_found'], 404);
        }
        if (!in_array($orig->status, ['failed', 'cancelled', 'expired'])) {
            return response()->json(['error' => 'only_terminal_failure_retryable', 'current_status' => $orig->status], 409);
        }

        $client = DB::table('authorized_clients')->where('client_id', $orig->client_id)->first();
        if (!$client || !$client->is_active) {
            return response()->json(['error' => 'client_not_active'], 403);
        }

        $today = date('Y-m-d');
        $used = $quota->getDailyCount($client->client_id, $today);
        if ($used >= $client->daily_limit) {
            return response()->json([
                'error' => 'quota_exceeded',
                'daily_used' => $used,
                'daily_limit' => $client->daily_limit,
            ], 429);
        }

        $newBuildId = (string) Str::uuid();
        $callbackToken = bin2hex(random_bytes(32));
        $now = now();

        DB::table('build_requests')->insert([
            'build_id' => $newBuildId,
            'client_id' => $orig->client_id,
            'app_name' => $orig->app_name,
            'icon_path' => $orig->icon_path ?: 'placeholder.png',
            'platform' => $orig->platform,
            'build_mode' => $orig->build_mode ?? 'normal',
            'oem_project_key' => $orig->oem_project_key ?? null,
            'app_version' => $orig->app_version,
            'app_id' => $orig->app_id ?? null,
            'update_path' => $orig->update_path ?? null,
            'build_options' => $orig->build_options ?? null,
            'status' => 'pending',
            'callback_token' => $callbackToken,
            'queued_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $quota->incrDailyCount($client->client_id, $today);

        return response()->json([
            'status' => 'queued',
            'build_id' => $newBuildId,
            'retried_from' => $buildId,
        ], 200);
    }

    /** POST /admin/api/requests/{buildId}/force-purge */
    public function forcePurge(string $buildId, ArtifactPurgeService $purge): JsonResponse
    {
        $build = DB::table('build_requests')->where('build_id', $buildId)->first();
        if (!$build) {
            return response()->json(['error' => 'build_not_found'], 404);
        }
        if (!in_array($build->status, ['success', 'delivered', 'failed', 'expired'])) {
            return response()->json(['error' => 'cannot_purge_in_state', 'current_status' => $build->status], 409);
        }

        $purge->purgeForBuild($buildId);
        return response()->json(['status' => 'purged'], 200);
    }

}
