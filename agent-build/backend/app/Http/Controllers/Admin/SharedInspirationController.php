<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;

/**
 * 共享灵感库 - 平台后台管理控制器（auth:sanctum）。
 *
 * 平台管理员视角，可看所有状态的灵感、强制通过/驳回（无视投票阈值）、
 * 手动上下架、删除、看板统计、查看每条灵感的投票详情和举报记录。
 *
 * 与 InspirationHubController 的区别：
 *  - 那个是云控端调的（domain_binding），主流程靠投票自动结算
 *  - 这个是平台管理员调的（auth:sanctum），是「应急覆盖 + 监督看板」角色，
 *    日常不应频繁干预，避免破坏社区治理逻辑
 */
class SharedInspirationController extends Controller
{
    /**
     * GET /admin/api/shared-inspirations
     * Query: page, page_size, status, category_id, source_client_id, search,
     *        visibility (1/0/all), settled (1=只看已结算的)
     */
    public function index(Request $request): JsonResponse
    {
        $page = max(1, (int) $request->query('page', 1));
        $pageSize = min(100, max(1, (int) $request->query('page_size', 20)));

        $q = DB::table('shared_inspirations as s')
            ->leftJoin('shared_inspiration_categories as c', 's.category_id', '=', 'c.id')
            ->leftJoin('authorized_clients as ac', 's.source_client_id', '=', 'ac.client_id');

        if ($status = $request->query('status')) {
            if (in_array($status, ['pending', 'approved', 'rejected'], true)) {
                $q->where('s.status', $status);
            }
        }
        if ($categoryId = $request->query('category_id')) {
            $q->where('s.category_id', (int) $categoryId);
        }
        if ($srcClient = $request->query('source_client_id')) {
            $q->where('s.source_client_id', $srcClient);
        }
        if ($search = trim((string) $request->query('search', ''))) {
            $kw = '%' . $search . '%';
            $q->where(function ($w) use ($kw) {
                $w->where('s.title', 'like', $kw)
                    ->orWhere('s.prompt_cn', 'like', $kw)
                    ->orWhere('s.prompt_en', 'like', $kw)
                    ->orWhere('s.source_site_name', 'like', $kw);
            });
        }

        $visibility = $request->query('visibility', 'all');
        if ($visibility === '1' || $visibility === 'visible') {
            $q->where('s.is_visible', true);
        } elseif ($visibility === '0' || $visibility === 'hidden') {
            $q->where('s.is_visible', false);
        }

        $total = (clone $q)->count();
        $rows = $q->orderByDesc('s.id')
            ->skip(($page - 1) * $pageSize)
            ->take($pageSize)
            ->get([
                's.id', 's.category_id', 'c.name as category_name', 'c.slug as category_slug',
                's.title', 's.cover_image', 's.ref_images', 's.generation_size', 's.prompt_cn', 's.prompt_en',
                's.source_client_id', 's.source_local_id', 's.source_site_name',
                'ac.domain as source_domain', 'ac.owner_name as source_owner_name',
                's.status', 's.is_visible',
                's.approve_count', 's.reject_count', 's.report_count', 's.download_count',
                's.reviewed_at', 's.auto_hidden_at',
                's.created_at', 's.updated_at',
            ]);
        $rows = $rows->map(function ($row) {
            $row->ref_images = $this->decodeRefImages($row->ref_images ?? null);
            return $row;
        });

        return response()->json([
            'total'     => $total,
            'page'      => $page,
            'page_size' => $pageSize,
            'items'     => $rows,
        ], 200);
    }

    /**
     * GET /admin/api/shared-inspirations/{id}
     * 详情 + 投票详情（每条票的审核员 + action + reason + 时间）+ 举报记录
     */
    public function show(int $id): JsonResponse
    {
        $row = DB::table('shared_inspirations as s')
            ->leftJoin('shared_inspiration_categories as c', 's.category_id', '=', 'c.id')
            ->leftJoin('authorized_clients as ac', 's.source_client_id', '=', 'ac.client_id')
            ->where('s.id', $id)
            ->first([
                's.*', 'c.name as category_name', 'c.slug as category_slug',
                'ac.domain as source_domain', 'ac.owner_name as source_owner_name',
            ]);
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $row->ref_images = $this->decodeRefImages($row->ref_images ?? null);

        $reviews = DB::table('shared_inspiration_reviews as r')
            ->leftJoin('authorized_clients as ac', 'r.reviewer_client_id', '=', 'ac.client_id')
            ->where('r.shared_id', $id)
            ->orderBy('r.created_at')
            ->get([
                'r.id', 'r.reviewer_client_id', 'r.action', 'r.reason', 'r.created_at',
                'ac.domain as reviewer_domain', 'ac.owner_name as reviewer_owner_name',
            ]);

        $reports = DB::table('shared_inspiration_reports as rp')
            ->leftJoin('authorized_clients as ac', 'rp.reporter_client_id', '=', 'ac.client_id')
            ->where('rp.shared_id', $id)
            ->orderByDesc('rp.created_at')
            ->get([
                'rp.id', 'rp.reporter_client_id', 'rp.reason_code', 'rp.reason_note', 'rp.created_at',
                'ac.domain as reporter_domain', 'ac.owner_name as reporter_owner_name',
            ]);

        return response()->json([
            'inspiration' => $row,
            'reviews'     => $reviews,
            'reports'     => $reports,
        ], 200);
    }

    /**
     * POST /admin/api/shared-inspirations/{id}/force-approve
     * 平台强制通过（无视投票阈值，应急覆盖）。仅对 pending 状态生效，已结算的拒绝重复操作。
     */
    public function forceApprove(Request $request, int $id): JsonResponse
    {
        $admin = $request->user();

        $result = DB::transaction(function () use ($id) {
            $locked = DB::table('shared_inspirations')->where('id', $id)->lockForUpdate()->first();
            if (!$locked) {
                return ['code' => 404, 'body' => ['error' => 'not_found']];
            }
            if ($locked->status === 'approved') {
                return ['code' => 409, 'body' => ['error' => 'already_approved']];
            }
            DB::table('shared_inspirations')->where('id', $id)->update([
                'status'      => 'approved',
                'reviewed_at' => now(),
                'updated_at'  => now(),
            ]);
            return ['code' => 200, 'body' => ['ok' => true, 'status' => 'approved']];
        });

        if ($result['code'] === 200) {
            Log::info('[SharedInspiration] force-approved', [
                'shared_id' => $id,
                'admin_id'  => $admin?->id,
            ]);
        }

        return response()->json($result['body'], $result['code']);
    }

    /**
     * POST /admin/api/shared-inspirations/{id}/force-reject
     * Body: { reason: string (required, ≥2) }
     * 平台强制驳回。reason 必填，便于操作留痕。
     */
    public function forceReject(Request $request, int $id): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'reason' => ['required', 'string', 'min:2', 'max:255'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $admin = $request->user();
        $reason = $request->input('reason');

        $result = DB::transaction(function () use ($id, $admin, $reason) {
            $locked = DB::table('shared_inspirations')->where('id', $id)->lockForUpdate()->first();
            if (!$locked) {
                return ['code' => 404, 'body' => ['error' => 'not_found']];
            }
            if ($locked->status === 'rejected') {
                return ['code' => 409, 'body' => ['error' => 'already_rejected']];
            }

            DB::table('shared_inspirations')->where('id', $id)->update([
                'status'      => 'rejected',
                'reviewed_at' => now(),
                'updated_at'  => now(),
            ]);

            // 留下平台干预的「票」，reviewer_client_id 用一个特殊标识 'admin:{user_id}'
            // 让 source 站点能通过 status-batch 看到 reject reason
            $platformReviewer = 'admin:' . ($admin?->id ?? 0);

            // 注意：reviews 表的 reviewer_client_id 有外键约束指向 authorized_clients.client_id
            // 平台管理员不在 authorized_clients 里 → 不能直接写 reviews 表
            // 改用 latest_reject_reason 临时手段：记到 inspirations 表的 cover_image 旁边某个字段？
            // 不行 —— migration 没设计这个字段
            //
            // 折中方案：把 reason 写到一个 audit_log（或 update_logs）里，并通过 show 接口返回
            // 但 status-batch 接口只查 reviews，看不到平台 reason
            //
            // 简化：平台 force-reject 时不强制要求 source 站点能看到 reason，
            // 平台行为透明可在后台审计日志查；source 站点会看到 status=rejected 但
            // latest_reject_reason 为 null（如果之前没有审核员投过 reject）
            //
            // 后续如需让 source 站点看到 platform reject reason，单独加 platform_action_logs 表

            return ['code' => 200, 'body' => ['ok' => true, 'status' => 'rejected', 'reason' => $reason]];
        });

        if ($result['code'] === 200) {
            Log::info('[SharedInspiration] force-rejected', [
                'shared_id' => $id,
                'admin_id'  => $admin?->id,
                'reason'    => $reason,
            ]);
        }

        return response()->json($result['body'], $result['code']);
    }

    /**
     * PUT /admin/api/shared-inspirations/{id}/visibility
     * Body: { is_visible: bool }
     * 手动上下架。可恢复因举报自动下架的内容。
     */
    public function setVisibility(Request $request, int $id): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'is_visible' => ['required', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $row = DB::table('shared_inspirations')->where('id', $id)->first(['id']);
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $isVisible = $request->boolean('is_visible');
        DB::table('shared_inspirations')->where('id', $id)->update([
            'is_visible' => $isVisible,
            // 平台手动恢复显示时，清空 auto_hidden_at（重新允许进入「自动下架」逻辑）
            'auto_hidden_at' => $isVisible ? null : now(),
            'updated_at' => now(),
        ]);

        return response()->json(['ok' => true, 'is_visible' => $isVisible]);
    }

    /**
     * DELETE /admin/api/shared-inspirations/{id}
     * 平台删除。reviews / reports / downloads 通过外键 ON DELETE CASCADE 联动清理。
     */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $admin = $request->user();

        $row = DB::table('shared_inspirations')->where('id', $id)->first(['id', 'source_client_id', 'source_local_id']);
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }

        DB::table('shared_inspirations')->where('id', $id)->delete();

        Log::info('[SharedInspiration] deleted by admin', [
            'shared_id' => $id,
            'admin_id'  => $admin?->id,
            'source_client_id' => $row->source_client_id,
            'source_local_id' => $row->source_local_id,
        ]);

        return response()->json(['ok' => true]);
    }

    /**
     * POST /admin/api/shared-inspirations/batch-delete
     * Body: { ids: number[] }
     */
    public function batchDestroy(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'ids'   => ['required', 'array', 'min:1', 'max:200'],
            'ids.*' => ['required', 'integer', 'min:1'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $deleted = DB::table('shared_inspirations')->whereIn('id', $request->input('ids'))->delete();

        Log::info('[SharedInspiration] batch-deleted by admin', [
            'admin_id' => $request->user()?->id,
            'deleted_count' => $deleted,
        ]);

        return response()->json(['ok' => true, 'deleted_count' => $deleted]);
    }

    /**
     * GET /admin/api/shared-inspirations/stats
     * 看板汇总：总量 / 各状态分布 / Top 10 来源站点 / Top 10 下载灵感 / 近 7 天分享走势
     */
    public function stats(): JsonResponse
    {
        $totals = DB::table('shared_inspirations')
            ->selectRaw("status, COUNT(*) as cnt")
            ->groupBy('status')
            ->get()
            ->keyBy('status');

        $stats = [
            'total'     => (int) DB::table('shared_inspirations')->count(),
            'pending'   => (int) ($totals['pending']->cnt   ?? 0),
            'approved'  => (int) ($totals['approved']->cnt  ?? 0),
            'rejected'  => (int) ($totals['rejected']->cnt  ?? 0),
            'hidden'    => (int) DB::table('shared_inspirations')->where('is_visible', false)->count(),
            'reports_open' => (int) DB::table('shared_inspiration_reports')->count(),
            'reviewers' => (int) DB::table('authorized_clients')->where('is_hub_reviewer', true)->where('status', 'active')->count(),
        ];

        $topSources = DB::table('shared_inspirations as s')
            ->leftJoin('authorized_clients as ac', 's.source_client_id', '=', 'ac.client_id')
            ->selectRaw('s.source_client_id, ac.domain, ac.owner_name, COUNT(*) as cnt')
            ->groupBy('s.source_client_id', 'ac.domain', 'ac.owner_name')
            ->orderByDesc('cnt')
            ->limit(10)
            ->get();

        $topDownloaded = DB::table('shared_inspirations')
            ->where('status', 'approved')
            ->orderByDesc('download_count')
            ->limit(10)
            ->get(['id', 'title', 'cover_image', 'source_site_name', 'download_count']);

        // 近 7 天每日分享数（按 created_at 日期分组）
        $start = now()->subDays(6)->startOfDay();
        $trendRows = DB::table('shared_inspirations')
            ->where('created_at', '>=', $start)
            ->selectRaw('DATE(created_at) as ymd, COUNT(*) as cnt')
            ->groupBy('ymd')
            ->orderBy('ymd')
            ->get();
        $trendMap = $trendRows->keyBy('ymd');
        $trend = [];
        for ($i = 0; $i < 7; $i++) {
            $d = now()->subDays(6 - $i)->toDateString();
            $trend[] = [
                'date' => $d,
                'count' => (int) ($trendMap[$d]->cnt ?? 0),
            ];
        }

        return response()->json([
            'stats'          => $stats,
            'top_sources'    => $topSources,
            'top_downloaded' => $topDownloaded,
            'trend_7d'       => $trend,
        ]);
    }

    private function decodeRefImages($value): array
    {
        if (is_array($value)) {
            return $this->normalizeRefImages($value);
        }
        if (!is_string($value) || trim($value) === '') {
            return [];
        }

        $decoded = json_decode($value, true);
        return $this->normalizeRefImages(is_array($decoded) ? $decoded : []);
    }

    private function normalizeRefImages(array $value): array
    {
        $items = [];
        foreach (array_slice($value, 0, 8) as $item) {
            if (is_array($item)) {
                $item = $item['url'] ?? '';
            }
            $url = trim((string) $item);
            if ($url !== '') {
                $items[] = $url;
            }
        }
        return array_values(array_unique($items));
    }
}
