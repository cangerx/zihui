<?php

namespace App\Http\Controllers\Hub;

use App\Http\Controllers\Controller;
use App\Services\Hub\HubReviewerSubmitPolicy;
use App\Services\SystemSetting\SettingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;

/**
 * 共享灵感库对外 API 控制器（云控端调用）。
 *
 * 鉴权：所有端点都挂在 domain_binding 中间件后，request->attributes['authorized_client']
 * 由中间件注入；审核员专属端点（pendingList / review）再叠加 hub_reviewer 中间件。
 *
 * 端点清单（详见 routes/api.php）：
 *  公开层（任意已授权云控端）：
 *    - me / categories / list / show / submit / download / report / statusBatch / withdraw
 *  审核员层（is_hub_reviewer = true）：
 *    - pendingList / review
 *
 * 关键约定：
 *  - source_client_id 永远从中间件注入的 client 拿，不接受前端传入（防伪造来源）
 *  - 投票 / 举报 / 计数更新统一在 DB::transaction + lockForUpdate 中做（防并发竞争）
 *  - 投票一旦完成不可撤销（用户决策，不提供修改/删除接口）
 */
class InspirationHubController extends Controller
{
    private const SETTING_GROUP = 'inspiration_hub';

    private const REASON_CODES = ['invalid_image', 'inappropriate', 'duplicate', 'copyright', 'other'];

    private SettingService $settings;

    public function __construct(SettingService $settings)
    {
        $this->settings = $settings;
    }

    // ===== 1. /me 自我身份 + 阈值 =====

    /**
     * GET /api/inspiration-hub/me
     * 返回当前云控端的身份和共享库阈值。云控端打开「浏览共享库」抽屉时调一次，
     * 据此决定是否显示「待审核」Tab、「分享额度」等。
     */
    public function me(Request $request): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');

        $today = now()->toDateString();
        $todayUsed = DB::table('shared_inspirations')
            ->where('source_client_id', $client->client_id)
            ->whereDate('created_at', $today)
            ->count();

        return response()->json([
            'client_id'           => $client->client_id,
            'is_reviewer'         => (bool) ($client->is_hub_reviewer ?? false),
            'approve_threshold'   => $this->approveThreshold(),
            'reject_threshold'    => $this->rejectThreshold(),
            'report_threshold'    => $this->reportThreshold(),
            'submit_daily_limit'  => $this->submitDailyLimit(),
            'submit_daily_used'   => $todayUsed,
        ]);
    }

    // ===== 2. /categories 公共分类 =====

    /**
     * GET /api/inspiration-hub/categories
     * 返回 14 个标准分类（id / name / slug / sort_order），按 sort_order 排序。
     */
    public function categories(): JsonResponse
    {
        $rows = DB::table('shared_inspiration_categories')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get(['id', 'name', 'slug', 'sort_order']);

        return response()->json(['data' => $rows]);
    }

    // ===== 3. /list 浏览公开池 =====

    /**
     * GET /api/inspiration-hub/list
     * 浏览已通过审核 + 处于显示状态的灵感。
     *
     * Query：
     *   page, per_page (默认 20，最大 60)
     *   category_id (可选)
     *   search (标题 + prompt 模糊)
     *   exclude_self=1 (默认 0；为 1 时屏蔽当前请求方自己分享的)
     */
    public function list(Request $request): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');

        $perPage = min(60, max(1, (int) $request->query('per_page', 20)));
        $page = max(1, (int) $request->query('page', 1));

        $q = DB::table('shared_inspirations as s')
            ->leftJoin('shared_inspiration_categories as c', 's.category_id', '=', 'c.id')
            ->where('s.status', 'approved')
            ->where('s.is_visible', true);

        if ($request->filled('category_id')) {
            $q->where('s.category_id', (int) $request->input('category_id'));
        }
        if ($request->filled('search')) {
            $kw = '%' . $request->input('search') . '%';
            $q->where(function ($w) use ($kw) {
                $w->where('s.title', 'like', $kw)
                    ->orWhere('s.prompt_cn', 'like', $kw)
                    ->orWhere('s.prompt_en', 'like', $kw);
            });
        }
        if ($request->boolean('exclude_self')) {
            $q->where('s.source_client_id', '!=', $client->client_id);
        }

        $total = (clone $q)->count();
        $rows = $q->orderByDesc('s.id')
            ->skip(($page - 1) * $perPage)
            ->take($perPage)
            ->get([
                's.id', 's.category_id', 'c.name as category_name', 'c.slug as category_slug',
                's.title', 's.cover_image', 's.ref_images', 's.generation_size', 's.prompt_cn', 's.prompt_en',
                's.source_site_name', 's.download_count', 's.report_count',
                's.created_at',
            ]);

        // 一次批量查我对这批是否已举报，用 IN 优于逐条
        $ids = $rows->pluck('id')->all();
        $myReports = empty($ids) ? [] : DB::table('shared_inspiration_reports')
            ->whereIn('shared_id', $ids)
            ->where('reporter_client_id', $client->client_id)
            ->pluck('shared_id')
            ->all();
        $myReportSet = array_flip($myReports);

        $items = $rows->map(function ($r) use ($myReportSet) {
            $r->ref_images = $this->decodeRefImages($r->ref_images ?? null);
            $r->reported_by_me = isset($myReportSet[$r->id]);
            return $r;
        });

        return response()->json([
            'items' => $items,
            'total' => $total,
            'page'  => $page,
            'per_page' => $perPage,
        ]);
    }

    // ===== 4. /{id} 单条详情 =====

    /**
     * GET /api/inspiration-hub/{id}
     * 返回灵感详情。
     *  - 公开池仅当 status=approved + is_visible=true 时返回
     *  - 例外：调用方是该条的源站点 (source_client_id 匹配) 时永远可见，便于自查状态
     *  - 同样例外：调用方是审核员且该条 status=pending 时可见（审核员 Tab 用）
     */
    public function show(Request $request, int $id): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');

        $row = DB::table('shared_inspirations as s')
            ->leftJoin('shared_inspiration_categories as c', 's.category_id', '=', 'c.id')
            ->where('s.id', $id)
            ->first([
                's.*', 'c.name as category_name', 'c.slug as category_slug',
            ]);
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $isOwner = $row->source_client_id === $client->client_id;
        $isReviewer = (bool) ($client->is_hub_reviewer ?? false);

        $publiclyVisible = $row->status === 'approved' && (int) $row->is_visible === 1;
        if (!$publiclyVisible && !$isOwner && !($isReviewer && $row->status === 'pending')) {
            return response()->json(['error' => 'not_found'], 404);
        }

        // 我对此条的相关动作（已投票动作 / 已举报）
        $myReview = DB::table('shared_inspiration_reviews')
            ->where('shared_id', $id)
            ->where('reviewer_client_id', $client->client_id)
            ->first(['action', 'reason', 'created_at']);

        $reportedByMe = DB::table('shared_inspiration_reports')
            ->where('shared_id', $id)
            ->where('reporter_client_id', $client->client_id)
            ->exists();

        $row->my_review_action = $myReview ? $myReview->action : null;
        $row->my_review_reason = $myReview ? $myReview->reason : null;
        $row->reported_by_me = $reportedByMe;
        $row->ref_images = $this->decodeRefImages($row->ref_images ?? null);

        // 状态为 rejected 时附带最新一条 reject 的理由（便于源站点显示 tooltip）
        if ($row->status === 'rejected') {
            $latestReject = DB::table('shared_inspiration_reviews')
                ->where('shared_id', $id)
                ->where('action', 'reject')
                ->orderByDesc('created_at')
                ->first(['reason']);
            $row->latest_reject_reason = $latestReject ? $latestReject->reason : null;
        }

        return response()->json($row);
    }

    // ===== 5. /submit 分享 =====

    /**
     * POST /api/inspiration-hub/submit
     * 云控端分享一条本地灵感到共享库。
     *
     * Body:
     *  - hub_category_id (int, 必填)
     *  - title (string, 1-100, 必填)
     *  - cover_image_url (url, 必填，云控端原图公网 URL)
     *  - prompt_cn / prompt_en (二者至少一个非空)
     *  - source_local_id (int, 必填，云控端本地 inspirations.id)
     *  - site_name (string, 1-100, 必填，云控端自报站名)
     *
     * 风控：
     *  - 每日上限 inspiration_hub.submit_daily_limit
     *  - UNIQUE (source_client_id, source_local_id) 防重复（先做软校验给友好错误，DB 层兜底）
     */
    public function submit(Request $request): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');

        $validator = Validator::make($request->all(), [
            'hub_category_id' => ['required', 'integer'],
            'title'           => ['required', 'string', 'max:100'],
            'cover_image_url' => ['required', 'url', 'max:500'],
            'ref_images'      => ['nullable', 'array', 'max:8'],
            'ref_images.*'    => ['url', 'max:500'],
            'generation_size' => ['nullable', 'string', 'max:50'],
            'prompt_cn'       => ['nullable', 'string', 'max:5000'],
            'prompt_en'       => ['nullable', 'string', 'max:5000'],
            'source_local_id' => ['required', 'integer', 'min:1'],
            'site_name'       => ['required', 'string', 'max:100'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $promptCn = trim((string) $request->input('prompt_cn', ''));
        $promptEn = trim((string) $request->input('prompt_en', ''));
        $refImages = $this->normalizeRefImages($request->input('ref_images', []));
        $generationSize = $this->normalizeGenerationSize($request->input('generation_size'));
        if ($promptCn === '' && $promptEn === '') {
            return response()->json([
                'error' => 'validation_failed',
                'details' => ['prompt_cn' => ['中英文提示词至少填写一个']],
            ], 422);
        }

        $categoryExists = DB::table('shared_inspiration_categories')
            ->where('id', $request->input('hub_category_id'))
            ->exists();
        if (!$categoryExists) {
            return response()->json(['error' => 'invalid_hub_category'], 422);
        }

        $sourceLocalId = (int) $request->input('source_local_id');
        $duplicate = DB::table('shared_inspirations')
            ->where('source_client_id', $client->client_id)
            ->where('source_local_id', $sourceLocalId)
            ->first(['id', 'status']);
        if ($duplicate) {
            return response()->json([
                'error'     => 'already_shared',
                'shared_id' => $duplicate->id,
                'status'    => $duplicate->status,
            ], 409);
        }

        if (!HubReviewerSubmitPolicy::bypassDailyLimit($client)) {
            $dailyLimit = $this->submitDailyLimit();
            $todayUsed = DB::table('shared_inspirations')
                ->where('source_client_id', $client->client_id)
                ->whereDate('created_at', now()->toDateString())
                ->count();
            if ($todayUsed >= $dailyLimit) {
                return response()->json([
                    'error'      => 'submit_quota_exceeded',
                    'daily_used' => $todayUsed,
                    'daily_limit' => $dailyLimit,
                ], 429);
            }
        }

        $now = now();
        $status = HubReviewerSubmitPolicy::initialStatus($client);
        $sharedId = DB::table('shared_inspirations')->insertGetId([
            'category_id'      => (int) $request->input('hub_category_id'),
            'title'            => $request->input('title'),
            'cover_image'      => $request->input('cover_image_url'),
            'ref_images'       => empty($refImages) ? null : json_encode($refImages, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'generation_size'  => $generationSize,
            'prompt_cn'        => $promptCn,
            'prompt_en'        => $promptEn,
            'source_client_id' => $client->client_id,
            'source_local_id'  => $sourceLocalId,
            'source_site_name' => $request->input('site_name'),
            'status'           => $status,
            'reviewed_at'      => $status === 'approved' ? $now : null,
            'is_visible'       => true,
            'approve_count'    => 0,
            'reject_count'     => 0,
            'report_count'     => 0,
            'download_count'   => 0,
            'created_at'       => $now,
            'updated_at'       => $now,
        ]);

        Log::info('[InspirationHub] submitted', [
            'shared_id' => $sharedId,
            'source_client_id' => $client->client_id,
            'source_local_id' => $sourceLocalId,
        ]);

        return response()->json([
            'shared_id' => $sharedId,
            'status'    => $status,
        ], 201);
    }

    // ===== 6. /{id}/download 登记下载 =====

    /**
     * POST /api/inspiration-hub/{id}/download
     * 云控端将共享灵感拉取到本地前调一次，登记下载并 +1 计数。
     * 未通过审核或已下架的不允许下载。
     */
    public function download(Request $request, int $id): JsonResponse
    {
        $row = DB::table('shared_inspirations')
            ->where('id', $id)
            ->first(['id', 'status', 'is_visible']);
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }
        if ($row->status !== 'approved' || (int) $row->is_visible !== 1) {
            return response()->json(['error' => 'not_available'], 409);
        }

        DB::table('shared_inspirations')->where('id', $id)->increment('download_count');

        return response()->json(['ok' => true]);
    }

    // ===== 7. /{id}/report 举报 =====

    /**
     * POST /api/inspiration-hub/{id}/report
     * Body: { reason_code, reason_note? }
     *
     * 同一 client 对同一灵感只能举报一次（DB UNIQUE 兜底）。
     * 举报后 report_count 累计 >= report_threshold 时自动 is_visible=false。
     */
    public function report(Request $request, int $id): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');

        $validator = Validator::make($request->all(), [
            'reason_code' => ['required', 'string', 'in:' . implode(',', self::REASON_CODES)],
            'reason_note' => ['nullable', 'string', 'max:255'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $row = DB::table('shared_inspirations')->where('id', $id)->first(['id']);
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $threshold = $this->reportThreshold();

        try {
            DB::transaction(function () use ($id, $client, $request, $threshold) {
                $locked = DB::table('shared_inspirations')->where('id', $id)->lockForUpdate()->first();
                if (!$locked) {
                    abort(404);
                }

                // UNIQUE 兜底（业务先 INSERT，重复时拿到 QueryException 转 409）
                DB::table('shared_inspiration_reports')->insert([
                    'shared_id'           => $id,
                    'reporter_client_id'  => $client->client_id,
                    'reason_code'         => $request->input('reason_code'),
                    'reason_note'         => $request->input('reason_note'),
                    'created_at'          => now(),
                ]);

                DB::table('shared_inspirations')->where('id', $id)->increment('report_count');

                $latest = DB::table('shared_inspirations')->where('id', $id)->first(['report_count', 'is_visible']);
                if ($latest && $latest->report_count >= $threshold && (int) $latest->is_visible === 1) {
                    DB::table('shared_inspirations')->where('id', $id)->update([
                        'is_visible'     => false,
                        'auto_hidden_at' => now(),
                        'updated_at'     => now(),
                    ]);
                }
            });
        } catch (\Illuminate\Database\QueryException $e) {
            // 1062 = ER_DUP_ENTRY，被 UNIQUE 约束拦下
            // 注意运算符优先级：?? 低于 ===，必须显式用括号包住 ?? 子表达式
            if (($e->errorInfo[1] ?? null) === 1062) {
                return response()->json(['error' => 'already_reported'], 409);
            }
            throw $e;
        }

        $latest = DB::table('shared_inspirations')->where('id', $id)->first(['report_count', 'is_visible', 'auto_hidden_at']);

        return response()->json([
            'ok'           => true,
            'report_count' => (int) $latest->report_count,
            'is_visible'   => (bool) $latest->is_visible,
            'auto_hidden'  => $latest->auto_hidden_at !== null,
            'threshold'    => $threshold,
        ]);
    }

    // ===== 8. /status-batch 批量查我分享的状态 =====

    /**
     * POST /api/inspiration-hub/status-batch
     * Body: { shared_ids: number[] }
     *
     * 仅返回调用方自己分享的（source_client_id 匹配）记录的状态。
     * 越权记录直接不出现在结果里，不暴露存在性。
     *
     * 用于云控端列表「共享状态」列轮询。
     */
    public function statusBatch(Request $request): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');

        $validator = Validator::make($request->all(), [
            'shared_ids'   => ['required', 'array', 'min:1', 'max:100'],
            'shared_ids.*' => ['required', 'integer', 'min:1'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $ids = array_values(array_unique($request->input('shared_ids')));

        $rows = DB::table('shared_inspirations')
            ->whereIn('id', $ids)
            ->where('source_client_id', $client->client_id)
            ->get([
                'id', 'source_local_id', 'status', 'is_visible',
                'approve_count', 'reject_count', 'report_count',
                'auto_hidden_at', 'updated_at',
            ]);

        // rejected 时附带最新一条 reject 的 reason
        $rejectedIds = $rows->where('status', 'rejected')->pluck('id')->all();
        $rejectReasonMap = [];
        if (!empty($rejectedIds)) {
            $latestRejects = DB::table('shared_inspiration_reviews as r1')
                ->whereIn('r1.shared_id', $rejectedIds)
                ->where('r1.action', 'reject')
                ->whereNotExists(function ($q) {
                    $q->select(DB::raw(1))
                        ->from('shared_inspiration_reviews as r2')
                        ->whereColumn('r2.shared_id', 'r1.shared_id')
                        ->where('r2.action', 'reject')
                        ->whereColumn('r2.created_at', '>', 'r1.created_at');
                })
                ->get(['r1.shared_id', 'r1.reason']);
            foreach ($latestRejects as $lr) {
                $rejectReasonMap[$lr->shared_id] = $lr->reason;
            }
        }

        $out = $rows->map(function ($r) use ($rejectReasonMap) {
            $r->latest_reject_reason = $rejectReasonMap[$r->id] ?? null;
            return $r;
        });

        return response()->json(['items' => $out]);
    }

    // ===== 9. /by-source/{local_id} 撤回我分享的 =====

    /**
     * DELETE /api/inspiration-hub/by-source/{local_id}
     * 云控端撤回自己分享的某条灵感。任何状态都可撤回（包括已 rejected）。
     * 只能撤自己分享的，越权返 404 不暴露存在性。
     */
    public function withdrawBySource(Request $request, int $localId): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');

        $row = DB::table('shared_inspirations')
            ->where('source_client_id', $client->client_id)
            ->where('source_local_id', $localId)
            ->first(['id']);
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }

        // 关联的 reviews / reports 通过外键 ON DELETE CASCADE 自动清理
        DB::table('shared_inspirations')->where('id', $row->id)->delete();

        Log::info('[InspirationHub] withdrew', [
            'shared_id' => $row->id,
            'source_client_id' => $client->client_id,
            'source_local_id' => $localId,
        ]);

        return response()->json(['ok' => true, 'withdrawn_id' => $row->id]);
    }

    // ===== 10. /pending-list 审核员看待审池 =====

    /**
     * GET /api/inspiration-hub/pending-list
     * 仅审核员（hub_reviewer 中间件已校验）。返回所有 status=pending 的灵感，
     * 含当前票数、阈值和我已投状态。审核员 UI 据此渲染进度条 + 通过/驳回按钮。
     */
    public function pendingList(Request $request): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');

        $perPage = min(60, max(1, (int) $request->query('per_page', 20)));
        $page = max(1, (int) $request->query('page', 1));

        $q = DB::table('shared_inspirations as s')
            ->leftJoin('shared_inspiration_categories as c', 's.category_id', '=', 'c.id')
            ->where('s.status', 'pending');

        if ($request->filled('category_id')) {
            $q->where('s.category_id', (int) $request->input('category_id'));
        }

        $total = (clone $q)->count();
        $rows = $q->orderBy('s.created_at')  // 老的排前，先到先审
            ->skip(($page - 1) * $perPage)
            ->take($perPage)
            ->get([
                's.id', 's.category_id', 'c.name as category_name', 'c.slug as category_slug',
                's.title', 's.cover_image', 's.ref_images', 's.generation_size', 's.prompt_cn', 's.prompt_en',
                's.source_site_name', 's.approve_count', 's.reject_count',
                's.created_at',
            ]);

        // 批量取我投票状态
        $ids = $rows->pluck('id')->all();
        $myVotes = empty($ids) ? [] : DB::table('shared_inspiration_reviews')
            ->whereIn('shared_id', $ids)
            ->where('reviewer_client_id', $client->client_id)
            ->get(['shared_id', 'action'])
            ->keyBy('shared_id')
            ->map->action
            ->all();

        $items = $rows->map(function ($r) use ($myVotes) {
            $r->ref_images = $this->decodeRefImages($r->ref_images ?? null);
            $r->my_review_action = $myVotes[$r->id] ?? null;
            return $r;
        });

        return response()->json([
            'items'             => $items,
            'total'             => $total,
            'page'              => $page,
            'per_page'          => $perPage,
            'approve_threshold' => $this->approveThreshold(),
            'reject_threshold'  => $this->rejectThreshold(),
        ]);
    }

    // ===== 11. /{id}/review 审核员投票 =====

    /**
     * POST /api/inspiration-hub/{id}/review
     * Body: { action: 'approve'|'reject', reason?: string }
     *
     * 投票约束：
     *  - 仅审核员（hub_reviewer 中间件已校验）
     *  - 状态必须 pending（已结算的拒绝再投）
     *  - action=reject 时 reason 必填且 >= 2 字
     *  - 一票不可撤销（业务层不提供修改/删除接口；UNIQUE 兜底防重投）
     *  - 自审允许（用户决策，同站不豁免）
     *
     * 阈值结算：
     *  - reject_count >= reject_threshold → status=rejected （reject 优先）
     *  - approve_count >= approve_threshold → status=approved
     */
    public function review(Request $request, int $id): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');

        $validator = Validator::make($request->all(), [
            'action' => ['required', 'in:approve,reject'],
            'reason' => ['nullable', 'string', 'max:255'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $action = $request->input('action');
        $reason = trim((string) $request->input('reason', ''));

        if ($action === 'reject' && mb_strlen($reason) < 2) {
            return response()->json([
                'error' => 'validation_failed',
                'details' => ['reason' => ['驳回必须填写理由（≥ 2 字）']],
            ], 422);
        }

        $approveThreshold = $this->approveThreshold();
        $rejectThreshold = $this->rejectThreshold();

        try {
            $finalStatus = DB::transaction(function () use ($id, $client, $action, $reason, $approveThreshold, $rejectThreshold) {
                $locked = DB::table('shared_inspirations')->where('id', $id)->lockForUpdate()->first();
                if (!$locked) {
                    abort(404);
                }
                if ($locked->status !== 'pending') {
                    return ['error' => 'already_settled', 'status' => $locked->status];
                }

                // 投票（UNIQUE 兜底防重投，捕获 1062 转 409）
                DB::table('shared_inspiration_reviews')->insert([
                    'shared_id'           => $id,
                    'reviewer_client_id'  => $client->client_id,
                    'action'              => $action,
                    'reason'              => $reason !== '' ? $reason : null,
                    'created_at'          => now(),
                ]);

                $col = $action === 'approve' ? 'approve_count' : 'reject_count';
                DB::table('shared_inspirations')->where('id', $id)->increment($col);

                $latest = DB::table('shared_inspirations')->where('id', $id)->first([
                    'approve_count', 'reject_count', 'status',
                ]);

                // reject 优先级高（一旦达 reject 阈值就丢弃，即使同时也达了 approve）
                if ($latest->reject_count >= $rejectThreshold) {
                    DB::table('shared_inspirations')->where('id', $id)->update([
                        'status'      => 'rejected',
                        'reviewed_at' => now(),
                        'updated_at'  => now(),
                    ]);
                    return ['settled' => 'rejected'];
                }
                if ($latest->approve_count >= $approveThreshold) {
                    DB::table('shared_inspirations')->where('id', $id)->update([
                        'status'      => 'approved',
                        'reviewed_at' => now(),
                        'updated_at'  => now(),
                    ]);
                    return ['settled' => 'approved'];
                }

                return ['settled' => null];
            });
        } catch (\Illuminate\Database\QueryException $e) {
            if (($e->errorInfo[1] ?? null) === 1062) {
                return response()->json(['error' => 'already_voted'], 409);
            }
            throw $e;
        }

        if (isset($finalStatus['error'])) {
            return response()->json($finalStatus, 409);
        }

        // 投票成功 + 是否触发结算
        $latest = DB::table('shared_inspirations')->where('id', $id)->first([
            'status', 'approve_count', 'reject_count', 'reviewed_at',
        ]);

        return response()->json([
            'ok'                => true,
            'my_action'         => $action,
            'shared_status'     => $latest->status,
            'approve_count'     => (int) $latest->approve_count,
            'reject_count'      => (int) $latest->reject_count,
            'approve_threshold' => $approveThreshold,
            'reject_threshold'  => $rejectThreshold,
            'settled'           => $finalStatus['settled'] ?? null,
        ]);
    }

    // ===== 阈值读取 helpers =====

    private function approveThreshold(): int
    {
        return max(1, (int) $this->settings->get(self::SETTING_GROUP, 'approve_threshold', 3));
    }

    private function rejectThreshold(): int
    {
        return max(1, (int) $this->settings->get(self::SETTING_GROUP, 'reject_threshold', 2));
    }

    private function reportThreshold(): int
    {
        return max(1, (int) $this->settings->get(self::SETTING_GROUP, 'report_threshold', 5));
    }

    private function submitDailyLimit(): int
    {
        return max(1, (int) $this->settings->get(self::SETTING_GROUP, 'submit_daily_limit', 20));
    }

    private function normalizeRefImages($value): array
    {
        if (!is_array($value)) {
            return [];
        }

        $items = [];
        foreach (array_slice($value, 0, 8) as $item) {
            $url = trim((string) $item);
            if ($url !== '') {
                $items[] = $url;
            }
        }

        return array_values(array_unique($items));
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

    private function normalizeGenerationSize($value): ?string
    {
        $size = trim((string) $value);
        return $size === '' ? null : mb_substr($size, 0, 50);
    }
}
