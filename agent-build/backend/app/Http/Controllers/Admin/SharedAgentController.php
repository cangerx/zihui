<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;

class SharedAgentController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $page = max(1, (int) $request->query('page', 1));
        $pageSize = min(100, max(1, (int) $request->query('page_size', 20)));

        $q = DB::table('shared_agents as a')
            ->leftJoin('shared_agent_categories as c', 'a.category_id', '=', 'c.id')
            ->leftJoin('authorized_clients as ac', 'a.source_client_id', '=', 'ac.client_id');

        if ($status = $request->query('status')) {
            if (in_array($status, ['pending', 'approved', 'rejected'], true)) {
                $q->where('a.status', $status);
            }
        }
        if ($categoryId = $request->query('category_id')) {
            $q->where('a.category_id', (int) $categoryId);
        }
        if ($srcClient = $request->query('source_client_id')) {
            $q->where('a.source_client_id', $srcClient);
        }
        if ($search = trim((string) $request->query('search', ''))) {
            $kw = '%' . $search . '%';
            $q->where(function ($w) use ($kw) {
                $w->where('a.name', 'like', $kw)
                    ->orWhere('a.description', 'like', $kw)
                    ->orWhere('a.system_prompt', 'like', $kw)
                    ->orWhere('a.source_site_name', 'like', $kw);
            });
        }

        $visibility = $request->query('visibility', 'all');
        if ($visibility === '1' || $visibility === 'visible') {
            $q->where('a.is_visible', true);
        } elseif ($visibility === '0' || $visibility === 'hidden') {
            $q->where('a.is_visible', false);
        }

        $total = (clone $q)->count();
        $rows = $q->orderByDesc('a.id')
            ->skip(($page - 1) * $pageSize)
            ->take($pageSize)
            ->get([
                'a.id', 'a.category_id', 'c.name as category_name', 'c.slug as category_slug',
                'a.name', 'a.description', 'a.avatar', 'a.system_prompt', 'a.tool_skill_ids',
                'a.tool_approval', 'a.enable_image_gen', 'a.tags', 'a.source_metadata',
                'a.source_client_id', 'a.source_local_id', 'a.source_site_name',
                'ac.domain as source_domain', 'ac.owner_name as source_owner_name',
                'a.status', 'a.is_visible', 'a.approve_count', 'a.reject_count', 'a.report_count',
                'a.download_count', 'a.reviewed_at', 'a.auto_hidden_at', 'a.created_at', 'a.updated_at',
            ]);

        $rows = $rows->map(function ($row) {
            $this->decodeAgentJsonFields($row);
            return $row;
        });

        return response()->json([
            'total' => $total,
            'page' => $page,
            'page_size' => $pageSize,
            'items' => $rows,
        ]);
    }

    public function show(int $id): JsonResponse
    {
        $row = DB::table('shared_agents as a')
            ->leftJoin('shared_agent_categories as c', 'a.category_id', '=', 'c.id')
            ->leftJoin('authorized_clients as ac', 'a.source_client_id', '=', 'ac.client_id')
            ->where('a.id', $id)
            ->first(['a.*', 'c.name as category_name', 'c.slug as category_slug', 'ac.domain as source_domain', 'ac.owner_name as source_owner_name']);
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $this->decodeAgentJsonFields($row);

        $reviews = DB::table('shared_agent_reviews as r')
            ->leftJoin('authorized_clients as ac', 'r.reviewer_client_id', '=', 'ac.client_id')
            ->where('r.shared_id', $id)
            ->orderBy('r.created_at')
            ->get([
                'r.id', 'r.reviewer_client_id', 'r.action', 'r.reason', 'r.created_at',
                'ac.domain as reviewer_domain', 'ac.owner_name as reviewer_owner_name',
            ]);

        $reports = DB::table('shared_agent_reports as rp')
            ->leftJoin('authorized_clients as ac', 'rp.reporter_client_id', '=', 'ac.client_id')
            ->where('rp.shared_id', $id)
            ->orderByDesc('rp.created_at')
            ->get([
                'rp.id', 'rp.reporter_client_id', 'rp.reason_code', 'rp.reason_note', 'rp.created_at',
                'ac.domain as reporter_domain', 'ac.owner_name as reporter_owner_name',
            ]);

        return response()->json([
            'agent' => $row,
            'reviews' => $reviews,
            'reports' => $reports,
        ]);
    }

    public function forceApprove(Request $request, int $id): JsonResponse
    {
        $admin = $request->user();
        $result = DB::transaction(function () use ($id) {
            $locked = DB::table('shared_agents')->where('id', $id)->lockForUpdate()->first();
            if (!$locked) {
                return ['code' => 404, 'body' => ['error' => 'not_found']];
            }
            if ($locked->status === 'approved') {
                return ['code' => 409, 'body' => ['error' => 'already_approved']];
            }
            DB::table('shared_agents')->where('id', $id)->update([
                'status' => 'approved',
                'reviewed_at' => now(),
                'updated_at' => now(),
            ]);
            return ['code' => 200, 'body' => ['ok' => true, 'status' => 'approved']];
        });

        if ($result['code'] === 200) {
            Log::info('[SharedAgent] force-approved', ['shared_id' => $id, 'admin_id' => $admin?->id]);
        }
        return response()->json($result['body'], $result['code']);
    }

    public function forceReject(Request $request, int $id): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'reason' => ['required', 'string', 'min:2', 'max:255'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $admin = $request->user();
        $reason = (string) $request->input('reason');
        $result = DB::transaction(function () use ($id, $reason) {
            $locked = DB::table('shared_agents')->where('id', $id)->lockForUpdate()->first();
            if (!$locked) {
                return ['code' => 404, 'body' => ['error' => 'not_found']];
            }
            if ($locked->status === 'rejected') {
                return ['code' => 409, 'body' => ['error' => 'already_rejected']];
            }
            DB::table('shared_agents')->where('id', $id)->update([
                'status' => 'rejected',
                'reviewed_at' => now(),
                'updated_at' => now(),
            ]);
            return ['code' => 200, 'body' => ['ok' => true, 'status' => 'rejected', 'reason' => $reason]];
        });

        if ($result['code'] === 200) {
            Log::info('[SharedAgent] force-rejected', [
                'shared_id' => $id,
                'admin_id' => $admin?->id,
                'reason' => $reason,
            ]);
        }
        return response()->json($result['body'], $result['code']);
    }

    public function setVisibility(Request $request, int $id): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'is_visible' => ['required', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $row = DB::table('shared_agents')->where('id', $id)->first(['id']);
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $isVisible = $request->boolean('is_visible');
        DB::table('shared_agents')->where('id', $id)->update([
            'is_visible' => $isVisible,
            'auto_hidden_at' => $isVisible ? null : now(),
            'updated_at' => now(),
        ]);
        return response()->json(['ok' => true, 'is_visible' => $isVisible]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $admin = $request->user();
        $row = DB::table('shared_agents')->where('id', $id)->first(['id', 'source_client_id', 'source_local_id']);
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }
        DB::table('shared_agents')->where('id', $id)->delete();
        Log::info('[SharedAgent] deleted by admin', [
            'shared_id' => $id,
            'admin_id' => $admin?->id,
            'source_client_id' => $row->source_client_id,
            'source_local_id' => $row->source_local_id,
        ]);
        return response()->json(['ok' => true]);
    }

    public function batchDestroy(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'ids' => ['required', 'array', 'min:1', 'max:200'],
            'ids.*' => ['required', 'integer', 'min:1'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $deleted = DB::table('shared_agents')->whereIn('id', $request->input('ids'))->delete();
        Log::info('[SharedAgent] batch-deleted by admin', [
            'admin_id' => $request->user()?->id,
            'deleted_count' => $deleted,
        ]);
        return response()->json(['ok' => true, 'deleted_count' => $deleted]);
    }

    public function stats(): JsonResponse
    {
        $totals = DB::table('shared_agents')
            ->selectRaw('status, COUNT(*) as cnt')
            ->groupBy('status')
            ->get()
            ->keyBy('status');

        $stats = [
            'total' => (int) DB::table('shared_agents')->count(),
            'pending' => (int) ($totals['pending']->cnt ?? 0),
            'approved' => (int) ($totals['approved']->cnt ?? 0),
            'rejected' => (int) ($totals['rejected']->cnt ?? 0),
            'hidden' => (int) DB::table('shared_agents')->where('is_visible', false)->count(),
            'reports_open' => (int) DB::table('shared_agent_reports')->count(),
            'reviewers' => (int) DB::table('authorized_clients')->where('is_hub_reviewer', true)->where('status', 'active')->count(),
        ];

        $topSources = DB::table('shared_agents as a')
            ->leftJoin('authorized_clients as ac', 'a.source_client_id', '=', 'ac.client_id')
            ->selectRaw('a.source_client_id, ac.domain, ac.owner_name, COUNT(*) as cnt')
            ->groupBy('a.source_client_id', 'ac.domain', 'ac.owner_name')
            ->orderByDesc('cnt')
            ->limit(10)
            ->get();

        $topDownloaded = DB::table('shared_agents')
            ->where('status', 'approved')
            ->orderByDesc('download_count')
            ->limit(10)
            ->get(['id', 'name', 'avatar', 'source_site_name', 'download_count']);

        $start = now()->subDays(6)->startOfDay();
        $trendRows = DB::table('shared_agents')
            ->where('created_at', '>=', $start)
            ->selectRaw('DATE(created_at) as ymd, COUNT(*) as cnt')
            ->groupBy('ymd')
            ->orderBy('ymd')
            ->get();
        $trendMap = $trendRows->keyBy('ymd');
        $trend = [];
        for ($i = 0; $i < 7; $i++) {
            $d = now()->subDays(6 - $i)->toDateString();
            $trend[] = ['date' => $d, 'count' => (int) ($trendMap[$d]->cnt ?? 0)];
        }

        return response()->json([
            'stats' => $stats,
            'top_sources' => $topSources,
            'top_downloaded' => $topDownloaded,
            'trend_7d' => $trend,
        ]);
    }

    private function decodeAgentJsonFields(object $row): void
    {
        $row->tool_skill_ids = $this->decodeArray($row->tool_skill_ids ?? null);
        $row->tags = $this->decodeArray($row->tags ?? null);
        $row->source_metadata = $this->decodeArray($row->source_metadata ?? null);
    }

    private function decodeArray($value): array
    {
        if (is_array($value)) {
            return $value;
        }
        if (!is_string($value) || trim($value) === '') {
            return [];
        }
        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : [];
    }
}
