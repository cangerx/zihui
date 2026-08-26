<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;

class SharedCreativeTemplateController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $page = max(1, (int) $request->query('page', 1));
        $pageSize = min(100, max(1, (int) $request->query('page_size', 20)));

        $q = DB::table('shared_creative_templates as t')
            ->leftJoin('shared_creative_template_categories as c', 't.category_id', '=', 'c.id')
            ->leftJoin('authorized_clients as ac', 't.source_client_id', '=', 'ac.client_id');

        if ($status = $request->query('status')) {
            if (in_array($status, ['pending', 'approved', 'rejected'], true)) {
                $q->where('t.status', $status);
            }
        }
        if ($categoryId = $request->query('category_id')) {
            $q->where('t.category_id', (int) $categoryId);
        }
        if ($srcClient = $request->query('source_client_id')) {
            $q->where('t.source_client_id', $srcClient);
        }
        if ($sourceType = $request->query('source_type')) {
            $q->where('t.source_type', $sourceType);
        }
        if ($search = trim((string) $request->query('search', ''))) {
            $kw = '%' . $search . '%';
            $q->where(function ($w) use ($kw) {
                $w->where('t.title', 'like', $kw)
                    ->orWhere('t.description', 'like', $kw)
                    ->orWhere('t.prompt_template', 'like', $kw)
                    ->orWhere('t.source_site_name', 'like', $kw);
            });
        }

        $visibility = $request->query('visibility', 'all');
        if ($visibility === '1' || $visibility === 'visible') {
            $q->where('t.is_visible', true);
        } elseif ($visibility === '0' || $visibility === 'hidden') {
            $q->where('t.is_visible', false);
        }

        $total = (clone $q)->count();
        $rows = $q->orderByDesc('t.id')
            ->skip(($page - 1) * $pageSize)
            ->take($pageSize)
            ->get([
                't.id', 't.category_id', 'c.name as category_name', 'c.slug as category_slug',
                't.title', 't.description', 't.cover_image', 't.example_ref_images', 't.requires_ref_image',
                't.default_size', 't.prompt_template', 't.variables', 't.source_type', 't.source_image',
                't.source_inspiration_id', 't.source_metadata', 't.source_client_id', 't.source_local_id',
                't.source_site_name', 'ac.domain as source_domain', 'ac.owner_name as source_owner_name',
                't.status', 't.is_visible', 't.approve_count', 't.reject_count', 't.report_count',
                't.download_count', 't.reviewed_at', 't.auto_hidden_at', 't.created_at', 't.updated_at',
            ]);

        $rows = $rows->map(function ($row) {
            $this->decodeTemplateJsonFields($row);
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
        $row = DB::table('shared_creative_templates as t')
            ->leftJoin('shared_creative_template_categories as c', 't.category_id', '=', 'c.id')
            ->leftJoin('authorized_clients as ac', 't.source_client_id', '=', 'ac.client_id')
            ->where('t.id', $id)
            ->first(['t.*', 'c.name as category_name', 'c.slug as category_slug', 'ac.domain as source_domain', 'ac.owner_name as source_owner_name']);
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $this->decodeTemplateJsonFields($row);

        $reviews = DB::table('shared_creative_template_reviews as r')
            ->leftJoin('authorized_clients as ac', 'r.reviewer_client_id', '=', 'ac.client_id')
            ->where('r.shared_id', $id)
            ->orderBy('r.created_at')
            ->get([
                'r.id', 'r.reviewer_client_id', 'r.action', 'r.reason', 'r.created_at',
                'ac.domain as reviewer_domain', 'ac.owner_name as reviewer_owner_name',
            ]);

        $reports = DB::table('shared_creative_template_reports as rp')
            ->leftJoin('authorized_clients as ac', 'rp.reporter_client_id', '=', 'ac.client_id')
            ->where('rp.shared_id', $id)
            ->orderByDesc('rp.created_at')
            ->get([
                'rp.id', 'rp.reporter_client_id', 'rp.reason_code', 'rp.reason_note', 'rp.created_at',
                'ac.domain as reporter_domain', 'ac.owner_name as reporter_owner_name',
            ]);

        return response()->json([
            'template' => $row,
            'reviews' => $reviews,
            'reports' => $reports,
        ]);
    }

    public function forceApprove(Request $request, int $id): JsonResponse
    {
        $admin = $request->user();
        $result = DB::transaction(function () use ($id) {
            $locked = DB::table('shared_creative_templates')->where('id', $id)->lockForUpdate()->first();
            if (!$locked) {
                return ['code' => 404, 'body' => ['error' => 'not_found']];
            }
            if ($locked->status === 'approved') {
                return ['code' => 409, 'body' => ['error' => 'already_approved']];
            }
            DB::table('shared_creative_templates')->where('id', $id)->update([
                'status' => 'approved',
                'reviewed_at' => now(),
                'updated_at' => now(),
            ]);
            return ['code' => 200, 'body' => ['ok' => true, 'status' => 'approved']];
        });

        if ($result['code'] === 200) {
            Log::info('[SharedCreativeTemplate] force-approved', ['shared_id' => $id, 'admin_id' => $admin?->id]);
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
            $locked = DB::table('shared_creative_templates')->where('id', $id)->lockForUpdate()->first();
            if (!$locked) {
                return ['code' => 404, 'body' => ['error' => 'not_found']];
            }
            if ($locked->status === 'rejected') {
                return ['code' => 409, 'body' => ['error' => 'already_rejected']];
            }
            DB::table('shared_creative_templates')->where('id', $id)->update([
                'status' => 'rejected',
                'reviewed_at' => now(),
                'updated_at' => now(),
            ]);
            return ['code' => 200, 'body' => ['ok' => true, 'status' => 'rejected', 'reason' => $reason]];
        });

        if ($result['code'] === 200) {
            Log::info('[SharedCreativeTemplate] force-rejected', [
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

        $row = DB::table('shared_creative_templates')->where('id', $id)->first(['id']);
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $isVisible = $request->boolean('is_visible');
        DB::table('shared_creative_templates')->where('id', $id)->update([
            'is_visible' => $isVisible,
            'auto_hidden_at' => $isVisible ? null : now(),
            'updated_at' => now(),
        ]);
        return response()->json(['ok' => true, 'is_visible' => $isVisible]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $admin = $request->user();
        $row = DB::table('shared_creative_templates')->where('id', $id)->first(['id', 'source_client_id', 'source_local_id']);
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }
        DB::table('shared_creative_templates')->where('id', $id)->delete();
        Log::info('[SharedCreativeTemplate] deleted by admin', [
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

        $deleted = DB::table('shared_creative_templates')->whereIn('id', $request->input('ids'))->delete();
        Log::info('[SharedCreativeTemplate] batch-deleted by admin', [
            'admin_id' => $request->user()?->id,
            'deleted_count' => $deleted,
        ]);
        return response()->json(['ok' => true, 'deleted_count' => $deleted]);
    }

    public function stats(): JsonResponse
    {
        $totals = DB::table('shared_creative_templates')
            ->selectRaw('status, COUNT(*) as cnt')
            ->groupBy('status')
            ->get()
            ->keyBy('status');

        $stats = [
            'total' => (int) DB::table('shared_creative_templates')->count(),
            'pending' => (int) ($totals['pending']->cnt ?? 0),
            'approved' => (int) ($totals['approved']->cnt ?? 0),
            'rejected' => (int) ($totals['rejected']->cnt ?? 0),
            'hidden' => (int) DB::table('shared_creative_templates')->where('is_visible', false)->count(),
            'reports_open' => (int) DB::table('shared_creative_template_reports')->count(),
            'reviewers' => (int) DB::table('authorized_clients')->where('is_hub_reviewer', true)->where('status', 'active')->count(),
        ];

        $topSources = DB::table('shared_creative_templates as t')
            ->leftJoin('authorized_clients as ac', 't.source_client_id', '=', 'ac.client_id')
            ->selectRaw('t.source_client_id, ac.domain, ac.owner_name, COUNT(*) as cnt')
            ->groupBy('t.source_client_id', 'ac.domain', 'ac.owner_name')
            ->orderByDesc('cnt')
            ->limit(10)
            ->get();

        $topDownloaded = DB::table('shared_creative_templates')
            ->where('status', 'approved')
            ->orderByDesc('download_count')
            ->limit(10)
            ->get(['id', 'title', 'cover_image', 'source_site_name', 'download_count']);

        $start = now()->subDays(6)->startOfDay();
        $trendRows = DB::table('shared_creative_templates')
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

    private function decodeTemplateJsonFields(object $row): void
    {
        $row->example_ref_images = $this->decodeArray($row->example_ref_images ?? null);
        $row->variables = $this->decodeArray($row->variables ?? null);
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
