<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;

/**
 * 共享灵感库 - 举报池管理（auth:sanctum）。
 *
 * 业务逻辑：
 *  - 举报由云控端调 InspirationHubController::report 提交
 *  - 累计 report_count >= report_threshold 时自动 is_visible=false
 *  - 平台管理员看举报池有两类操作：
 *    1) 驳回举报：从 reports 表删一条，对应 inspirations.report_count -1。
 *       如果 report_count 因此低于 threshold 且当前因此自动下架的（auto_hidden_at NOT NULL），
 *       不自动恢复显示 —— 平台决定恢复要走 SharedInspirationController::setVisibility
 *    2) 处理灵感：直接跳到 SharedInspirationController::destroy / setVisibility
 *
 * 列表视图分两种：
 *  - 「按举报记录」逐条列出（默认，便于看每条举报的 reason_code / reason_note）
 *  - 「按灵感聚合」按 shared_id 聚合（grouped=1），便于看哪条灵感被举报最多
 */
class SharedInspirationReportController extends Controller
{
    /** GET /admin/api/shared-inspiration-reports */
    public function index(Request $request): JsonResponse
    {
        $page = max(1, (int) $request->query('page', 1));
        $pageSize = min(100, max(1, (int) $request->query('page_size', 20)));

        if ($request->boolean('grouped')) {
            return $this->groupedIndex($request, $page, $pageSize);
        }

        $q = DB::table('shared_inspiration_reports as rp')
            ->leftJoin('shared_inspirations as s', 'rp.shared_id', '=', 's.id')
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
                's.title as shared_title', 's.cover_image as shared_cover',
                's.status as shared_status', 's.is_visible as shared_is_visible',
                's.report_count', 's.source_site_name',
            ]);

        return response()->json([
            'total'     => $total,
            'page'      => $page,
            'page_size' => $pageSize,
            'items'     => $rows,
        ]);
    }

    /**
     * 按 shared_id 聚合的举报视图：哪些灵感被举报次数最多
     * Query: ?grouped=1
     */
    private function groupedIndex(Request $request, int $page, int $pageSize): JsonResponse
    {
        $q = DB::table('shared_inspirations as s')
            ->where('s.report_count', '>', 0);

        $total = (clone $q)->count();
        $rows = $q->orderByDesc('s.report_count')
            ->orderByDesc('s.id')
            ->skip(($page - 1) * $pageSize)
            ->take($pageSize)
            ->get([
                's.id as shared_id', 's.title', 's.cover_image', 's.source_site_name',
                's.status', 's.is_visible', 's.auto_hidden_at',
                's.report_count', 's.created_at',
            ]);

        return response()->json([
            'total'     => $total,
            'page'      => $page,
            'page_size' => $pageSize,
            'items'     => $rows,
        ]);
    }

    /**
     * DELETE /admin/api/shared-inspiration-reports/{id}
     * 驳回单条举报：删 reports 行 + inspirations.report_count -1。不自动恢复 visibility。
     */
    public function dismiss(Request $request, int $id): JsonResponse
    {
        $admin = $request->user();

        $report = DB::table('shared_inspiration_reports')->where('id', $id)->first();
        if (!$report) {
            return response()->json(['error' => 'not_found'], 404);
        }

        DB::transaction(function () use ($report, $id) {
            DB::table('shared_inspiration_reports')->where('id', $id)->delete();
            DB::table('shared_inspirations')
                ->where('id', $report->shared_id)
                ->where('report_count', '>', 0)
                ->decrement('report_count');
        });

        Log::info('[SharedInspirationReport] dismissed', [
            'report_id' => $id,
            'shared_id' => $report->shared_id,
            'admin_id'  => $admin?->id,
        ]);

        return response()->json(['ok' => true]);
    }

    /**
     * POST /admin/api/shared-inspiration-reports/batch-dismiss
     * Body: { ids: number[] } 批量驳回举报
     */
    public function batchDismiss(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'ids'   => ['required', 'array', 'min:1', 'max:200'],
            'ids.*' => ['required', 'integer', 'min:1'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $ids = $request->input('ids');
        $reports = DB::table('shared_inspiration_reports')->whereIn('id', $ids)->get(['id', 'shared_id']);
        if ($reports->isEmpty()) {
            return response()->json(['ok' => true, 'deleted_count' => 0]);
        }

        $sharedCounts = $reports->groupBy('shared_id')->map(fn ($g) => count($g));

        DB::transaction(function () use ($ids, $sharedCounts) {
            DB::table('shared_inspiration_reports')->whereIn('id', $ids)->delete();
            foreach ($sharedCounts as $sharedId => $cnt) {
                DB::table('shared_inspirations')
                    ->where('id', $sharedId)
                    ->where('report_count', '>=', $cnt)
                    ->decrement('report_count', $cnt);
            }
        });

        return response()->json(['ok' => true, 'deleted_count' => count($ids)]);
    }

    /**
     * 单条举报详情（便于平台审核员看完整 reason_note）
     * GET /admin/api/shared-inspiration-reports/{id}
     */
    public function show(int $id): JsonResponse
    {
        $row = DB::table('shared_inspiration_reports as rp')
            ->leftJoin('shared_inspirations as s', 'rp.shared_id', '=', 's.id')
            ->leftJoin('authorized_clients as ac', 'rp.reporter_client_id', '=', 'ac.client_id')
            ->where('rp.id', $id)
            ->first([
                'rp.*',
                's.title as shared_title', 's.cover_image as shared_cover',
                's.status as shared_status', 's.is_visible as shared_is_visible',
                's.source_site_name',
                'ac.domain as reporter_domain', 'ac.owner_name as reporter_owner_name',
            ]);
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }
        return response()->json($row);
    }
}
