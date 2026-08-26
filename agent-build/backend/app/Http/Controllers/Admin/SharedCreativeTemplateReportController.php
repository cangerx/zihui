<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;

class SharedCreativeTemplateReportController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $page = max(1, (int) $request->query('page', 1));
        $pageSize = min(100, max(1, (int) $request->query('page_size', 20)));

        if ($request->boolean('grouped')) {
            return $this->groupedIndex($page, $pageSize);
        }

        $q = DB::table('shared_creative_template_reports as rp')
            ->leftJoin('shared_creative_templates as t', 'rp.shared_id', '=', 't.id')
            ->leftJoin('authorized_clients as ac', 'rp.reporter_client_id', '=', 'ac.client_id');

        if ($code = $request->query('reason_code')) {
            $q->where('rp.reason_code', $code);
        }
        if ($sid = $request->query('shared_id')) {
            $q->where('rp.shared_id', (int) $sid);
        }

        $total = (clone $q)->count();
        $rows = $q->orderByDesc('rp.created_at')
            ->skip(($page - 1) * $pageSize)
            ->take($pageSize)
            ->get([
                'rp.id', 'rp.shared_id', 'rp.reason_code', 'rp.reason_note', 'rp.created_at',
                'rp.reporter_client_id', 'ac.domain as reporter_domain', 'ac.owner_name as reporter_owner_name',
                't.title as shared_title', 't.cover_image as shared_cover',
                't.status as shared_status', 't.is_visible as shared_is_visible',
                't.report_count', 't.source_site_name',
            ]);

        return response()->json([
            'total' => $total,
            'page' => $page,
            'page_size' => $pageSize,
            'items' => $rows,
        ]);
    }

    private function groupedIndex(int $page, int $pageSize): JsonResponse
    {
        $q = DB::table('shared_creative_templates as t')
            ->where('t.report_count', '>', 0);

        $total = (clone $q)->count();
        $rows = $q->orderByDesc('t.report_count')
            ->orderByDesc('t.id')
            ->skip(($page - 1) * $pageSize)
            ->take($pageSize)
            ->get([
                't.id as shared_id', 't.title', 't.cover_image', 't.source_site_name',
                't.status', 't.is_visible', 't.auto_hidden_at', 't.report_count', 't.created_at',
            ]);

        return response()->json([
            'total' => $total,
            'page' => $page,
            'page_size' => $pageSize,
            'items' => $rows,
        ]);
    }

    public function dismiss(Request $request, int $id): JsonResponse
    {
        $admin = $request->user();
        $report = DB::table('shared_creative_template_reports')->where('id', $id)->first();
        if (!$report) {
            return response()->json(['error' => 'not_found'], 404);
        }

        DB::transaction(function () use ($report, $id) {
            DB::table('shared_creative_template_reports')->where('id', $id)->delete();
            DB::table('shared_creative_templates')
                ->where('id', $report->shared_id)
                ->where('report_count', '>', 0)
                ->decrement('report_count');
        });

        Log::info('[SharedCreativeTemplateReport] dismissed', [
            'report_id' => $id,
            'shared_id' => $report->shared_id,
            'admin_id' => $admin?->id,
        ]);

        return response()->json(['ok' => true]);
    }

    public function batchDismiss(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'ids' => ['required', 'array', 'min:1', 'max:200'],
            'ids.*' => ['required', 'integer', 'min:1'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $ids = $request->input('ids');
        $reports = DB::table('shared_creative_template_reports')->whereIn('id', $ids)->get(['id', 'shared_id']);
        if ($reports->isEmpty()) {
            return response()->json(['ok' => true, 'deleted_count' => 0]);
        }

        $sharedCounts = $reports->groupBy('shared_id')->map(fn ($g) => count($g));
        DB::transaction(function () use ($ids, $sharedCounts) {
            DB::table('shared_creative_template_reports')->whereIn('id', $ids)->delete();
            foreach ($sharedCounts as $sharedId => $cnt) {
                DB::table('shared_creative_templates')
                    ->where('id', $sharedId)
                    ->where('report_count', '>=', $cnt)
                    ->decrement('report_count', $cnt);
            }
        });

        return response()->json(['ok' => true, 'deleted_count' => count($ids)]);
    }

    public function show(int $id): JsonResponse
    {
        $row = DB::table('shared_creative_template_reports as rp')
            ->leftJoin('shared_creative_templates as t', 'rp.shared_id', '=', 't.id')
            ->leftJoin('authorized_clients as ac', 'rp.reporter_client_id', '=', 'ac.client_id')
            ->where('rp.id', $id)
            ->first([
                'rp.*', 't.title as shared_title', 't.cover_image as shared_cover',
                't.status as shared_status', 't.is_visible as shared_is_visible',
                't.source_site_name', 'ac.domain as reporter_domain', 'ac.owner_name as reporter_owner_name',
            ]);
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }
        return response()->json($row);
    }
}
