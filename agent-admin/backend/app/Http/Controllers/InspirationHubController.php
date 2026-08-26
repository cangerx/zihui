<?php

namespace App\Http\Controllers;

use App\Models\Inspiration;
use App\Models\InspirationCategory;
use App\Models\SystemSetting;
use App\Services\InspirationHub\InspirationHubClient;
use App\Services\StorageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * 共享灵感库本地代理控制器（agent-admin 侧）。
 *
 * 整体职责：把云控端的灵感库与 agent-build 上的「跨 OEM 共享灵感库」对接，
 * 桌面端用户和后台管理员通过本控制器代理 → agent-build hub。
 *
 * 端点分两层：
 *  - client（auth.jwt）：浏览 hub / 分享自己的灵感 / 撤回 / 举报 / 状态轮询
 *  - admin（auth.jwt + admin）：阈值设置 / 健康检查 / 待审池 / 投票 / 拉取 hub 灵感入本地库
 *
 * 关键约定：
 *  - 任何端点先校验 hub.isReady()，未配置时直接 503，不让前端误以为「没数据」
 *  - share / withdraw 由桌面端用户触发，但只有该灵感的 uploader 或 admin 才能操作
 *  - statusBatch 接收的是本地 inspiration ID，内部解析 hub_shared_id 后转发，
 *    并把 hub 返回的状态同步写回 inspirations.hub_status / hub_status_synced_at
 */
class InspirationHubController extends Controller
{
    /** 拉取到本地时 cover 镶像使用的子目录，与 InspirationController::SUBDIR 保持一致，
     *  让本地原生上传 / 从 hub 拉取两条路径落盘后走同一份存储目录。 */
    private const COVER_SUBDIR = 'inspirations';

    /** 镶像远程图片的单张上限（8MB，略宽于本地上传的 5MB 校验，预留
     *  业内远程原图被压缩含量不严格的余地）。 */
    private const COVER_MIRROR_MAX_BYTES = 8 * 1024 * 1024;

    /** 远程 cover 下载超时（秒）。不走 业内 redirect 过多的场景，15s 足够。 */
    private const COVER_MIRROR_TIMEOUT = 15;

    private InspirationHubClient $hub;

    public function __construct(InspirationHubClient $hub)
    {
        $this->hub = $hub;
    }

    // ===========================================================================
    // ===== Client 层（已登录用户）
    // ===========================================================================

    /**
     * GET /api/client/inspiration-hub/me
     * 透传 hub /me，附加本站的 enabled / endpoint 状态便于桌面端 UI 展示。
     */
    public function me(): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json([
                'enabled'   => true,
                'ready'     => false,
                'reason'    => $this->notReadyReason(),
            ], 503);
        }

        try {
            $resp = $this->hub->get('/me');
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }

        return $this->forward($resp, function ($body) {
            return [
                'enabled' => true,
                'ready'   => true,
                'me'      => $body,
            ];
        });
    }

    /**
     * GET /api/client/inspiration-hub/categories
     */
    public function categories(): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'inspiration_hub_not_configured'], 503);
        }
        try {
            $resp = $this->hub->get('/categories');
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        return $this->forward($resp);
    }

    /**
     * GET /api/client/inspiration-hub/list
     * 透传 hub /list 的查询参数。
     *
     * 扩展参数（agent-admin 代理层处理，不传给 hub）：
     *  - exclude_pulled=1：过滤掉本站已经拉到本地的灵感（按 inspirations.from_hub_inspiration_id 反查）。
     *    hub 端无法知道哪些 client 拉过哪些，必须在代理层做。
     *
     * 注意 total 为代理层扫描到的可见数量，不为精确全量；避免为精确 total 扫描完整 hub 列表。
     */
    public function list(Request $request): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'inspiration_hub_not_configured'], 503);
        }

        $hubQuery = $request->query();
        unset($hubQuery['exclude_pulled']);
        if (isset($hubQuery['page_size']) && !isset($hubQuery['per_page'])) {
            $hubQuery['per_page'] = $hubQuery['page_size'];
        }
        unset($hubQuery['page_size']);

        if ($request->boolean('exclude_pulled')) {
            return $this->listWithoutPulled($hubQuery, $request);
        }

        try {
            $resp = $this->hub->get('/list', $hubQuery);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }

        return $this->forward($resp);
    }

    private function listWithoutPulled(array $hubQuery, Request $request): JsonResponse
    {
        $page = max(1, (int) $request->input('page', 1));
        $pageSize = min(100, max(1, (int) ($request->input('page_size') ?: $request->input('per_page', 24))));
        $hubPerPage = min(60, $pageSize);
        $targetStart = ($page - 1) * $pageSize;
        $targetEnd = $targetStart + $pageSize;
        $targetScanEnd = $targetEnd + 1;
        $scanPage = 1;
        $keptCount = 0;
        $resultItems = [];
        $lastBody = null;
        $rawTotal = 0;
        $seenHubIds = [];

        while ($scanPage <= 200) {
            $query = array_merge($hubQuery, [
                'page' => $scanPage,
                'per_page' => $hubPerPage,
            ]);

            try {
                $resp = $this->hub->get('/list', $query);
            } catch (RuntimeException $e) {
                return response()->json(['error' => $e->getMessage()], 503);
            }

            if (!$resp->successful()) {
                return $this->forward($resp);
            }

            $body = $resp->json();
            $lastBody = $body;
            $items = is_array($body['items'] ?? null) ? $body['items'] : [];
            $rawTotal = max($rawTotal, (int) ($body['total'] ?? 0));
            if (empty($items)) {
                break;
            }

            $pageItems = $this->filterPulledHubItems($items);
            foreach ($pageItems as $item) {
                $id = (int) ($item['id'] ?? 0);
                if ($id > 0 && isset($seenHubIds[$id])) continue;
                if ($id > 0) $seenHubIds[$id] = true;
                if ($keptCount >= $targetStart && $keptCount < $targetEnd) {
                    $resultItems[] = $item;
                }
                $keptCount++;
                if ($keptCount >= $targetScanEnd) {
                    break 2;
                }
            }

            $remotePage = (int) ($body['page'] ?? $scanPage);
            $remotePerPage = (int) ($body['per_page'] ?? $hubPerPage);
            $remoteTotal = (int) ($body['total'] ?? 0);
            if ($remoteTotal > 0 && $remotePage * $remotePerPage >= $remoteTotal) {
                break;
            }
            if (count($items) < $hubPerPage) {
                break;
            }

            $scanPage++;
        }

        return response()->json([
            'items' => $resultItems,
            'total' => $keptCount,
            'page' => $page,
            'per_page' => $pageSize,
            'raw_total' => $lastBody['total'] ?? $rawTotal,
        ]);
    }

    private function filterPulledHubItems(array $items): array
    {
        $hubIds = array_values(array_filter(array_map(
            fn ($item) => (int) ($item['id'] ?? 0),
            $items
        )));
        if (empty($hubIds)) return $items;

        $pulledHubIds = Inspiration::whereIn('from_hub_inspiration_id', $hubIds)
            ->pluck('from_hub_inspiration_id')
            ->map(fn ($v) => (int) $v)
            ->all();
        $pulledSet = array_flip($pulledHubIds);

        return array_values(array_filter($items, fn ($item) => !isset($pulledSet[(int) ($item['id'] ?? 0)])));
    }

    /**
     * GET /api/client/inspiration-hub/{hubId}
     */
    public function show(int $hubId): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'inspiration_hub_not_configured'], 503);
        }
        try {
            $resp = $this->hub->get('/' . $hubId);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        return $this->forward($resp);
    }

    /**
     * POST /api/client/inspiration-hub/status-batch
     * Body: { ids: [local_id_1, local_id_2, ...] }
     *
     * 流程：
     *  1. 查这批本地 inspiration 的 hub_shared_id（过滤 null）
     *  2. 调 hub /status-batch with shared_ids
     *  3. 把 hub 返回的 status / counts 写回本地 inspirations 表
     *  4. 返回 [{ local_id, hub_shared_id, hub_status, ... }]
     *
     * 注意：仅返回 ids 中确实分享过的；未分享的本地 id 直接从结果里跳过。
     */
    public function statusBatch(Request $request): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'inspiration_hub_not_configured'], 503);
        }

        $validator = Validator::make($request->all(), [
            'ids'   => ['required', 'array', 'min:1', 'max:100'],
            'ids.*' => ['required', 'integer', 'min:1'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $localIds = array_values(array_unique($request->input('ids')));

        // 取出本地有 hub_shared_id 的灵感
        $rows = Inspiration::whereIn('id', $localIds)
            ->whereNotNull('hub_shared_id')
            ->get(['id', 'hub_shared_id']);

        if ($rows->isEmpty()) {
            return response()->json(['items' => []]);
        }

        $sharedIds = $rows->pluck('hub_shared_id')->all();
        $sharedToLocal = $rows->keyBy('hub_shared_id');

        try {
            $resp = $this->hub->post('/status-batch', ['shared_ids' => $sharedIds]);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }

        if (!$resp->successful()) {
            return $this->forwardError($resp);
        }

        $items = $resp->json('items', []);
        $now = now();
        $output = [];

        DB::transaction(function () use ($items, $sharedToLocal, $now, &$output) {
            foreach ($items as $item) {
                $shared = $sharedToLocal->get($item['id'] ?? null);
                if (!$shared) continue;

                $localId = $shared->id;
                $hubStatus = $item['status'] ?? null;

                // 写回本地（但 cast 字段 hub_shared_id 等已 fillable）
                Inspiration::where('id', $localId)->update([
                    'hub_status'           => $hubStatus,
                    'hub_status_synced_at' => $now,
                ]);

                $output[] = [
                    'local_id'              => $localId,
                    'hub_shared_id'         => $item['id'] ?? null,
                    'hub_status'            => $hubStatus,
                    'is_visible'            => (bool) ($item['is_visible'] ?? true),
                    'approve_count'         => (int) ($item['approve_count'] ?? 0),
                    'reject_count'          => (int) ($item['reject_count'] ?? 0),
                    'report_count'          => (int) ($item['report_count'] ?? 0),
                    'auto_hidden_at'        => $item['auto_hidden_at'] ?? null,
                    'latest_reject_reason'  => $item['latest_reject_reason'] ?? null,
                ];
            }
        });

        return response()->json(['items' => $output]);
    }

    /**
     * POST /api/client/inspirations/{localId}/share
     * Body: { hub_category_id: int }
     *
     * 把本地 inspiration 分享到 hub。
     * 权限：必须是该灵感的 uploader_user_id 或 admin
     */
    public function shareToHub(Request $request, int $localId): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'inspiration_hub_not_configured'], 503);
        }

        $user = auth()->user();
        if (!$user) {
            return response()->json(['error' => 'unauthenticated'], 401);
        }

        $validator = Validator::make($request->all(), [
            'hub_category_id' => ['required', 'integer'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $insp = Inspiration::find($localId);
        if (!$insp) {
            return response()->json(['error' => 'not_found'], 404);
        }
        if ($user->role !== 'admin' && $insp->uploader_user_id !== $user->id) {
            return response()->json(['error' => 'forbidden', 'message' => '只能分享自己上传的灵感'], 403);
        }
        if ($insp->status !== Inspiration::STATUS_APPROVED) {
            return response()->json(['error' => 'not_approved', 'message' => '只有审核通过的灵感才能分享'], 422);
        }
        if ($insp->hub_shared_id) {
            return response()->json([
                'error' => 'already_shared',
                'shared_id' => $insp->hub_shared_id,
                'hub_status' => $insp->hub_status,
            ], 409);
        }
        // hub 拒绝 from_hub 灵感再次分享回去（避免循环）
        if ($insp->from_hub_inspiration_id) {
            return response()->json([
                'error' => 'cannot_share_from_hub',
                'message' => '从共享库拉取的灵感不能再次分享回去',
            ], 422);
        }

        $coverUrl = $this->resolveCoverUrl($insp->cover_image);
        if (!$coverUrl || !preg_match('#^https?://#i', $coverUrl)) {
            return response()->json([
                'error' => 'cover_image_unreachable',
                'message' => '封面图无公网 URL，请检查存储设置（如 cos_domain / app.url）',
            ], 422);
        }

        $rawRefImages = $this->normalizeRefImages($insp->ref_images ?? []);
        $refImages = $this->resolveImageUrls($rawRefImages);
        if (count($rawRefImages) !== count($refImages)) {
            return response()->json([
                'error' => 'ref_image_unreachable',
                'message' => '参考图无公网 URL，请检查存储设置（如 cos_domain / app.url）',
            ], 422);
        }

        $siteName = (string) SystemSetting::getValue('site_title', 'Agent Admin');

        $payload = [
            'hub_category_id' => (int) $request->input('hub_category_id'),
            'title'           => $insp->title,
            'cover_image_url' => $coverUrl,
            'ref_images'      => $refImages,
            'generation_size' => $insp->generation_size,
            'prompt_cn'       => (string) $insp->prompt_cn,
            'prompt_en'       => (string) $insp->prompt_en,
            'source_local_id' => $insp->id,
            'site_name'       => $siteName,
        ];

        try {
            $resp = $this->hub->post('/submit', $payload);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }

        if (!$resp->successful()) {
            return $this->forwardError($resp);
        }

        $body = $resp->json();
        $sharedId = (int) ($body['shared_id'] ?? 0);
        if ($sharedId > 0) {
            $insp->update([
                'hub_shared_id'        => $sharedId,
                'hub_status'           => $body['status'] ?? 'pending',
                'hub_status_synced_at' => now(),
            ]);
        }

        Log::info('[InspirationHub] shared to hub', [
            'local_id'  => $insp->id,
            'shared_id' => $sharedId,
            'user_id'   => $user->id,
        ]);

        return response()->json([
            'ok'             => true,
            'local_id'       => $insp->id,
            'hub_shared_id'  => $sharedId,
            'hub_status'     => $body['status'] ?? 'pending',
        ]);
    }

    /**
     * DELETE /api/client/inspirations/{localId}/share
     * 撤回本地灵感在 hub 上的分享。任何状态都可撤回（含 rejected）。
     * 权限：uploader 或 admin
     */
    public function withdrawFromHub(int $localId): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'inspiration_hub_not_configured'], 503);
        }

        $user = auth()->user();
        if (!$user) {
            return response()->json(['error' => 'unauthenticated'], 401);
        }

        $insp = Inspiration::find($localId);
        if (!$insp) {
            return response()->json(['error' => 'not_found'], 404);
        }
        if ($user->role !== 'admin' && $insp->uploader_user_id !== $user->id) {
            return response()->json(['error' => 'forbidden'], 403);
        }
        if (!$insp->hub_shared_id) {
            return response()->json(['error' => 'not_shared'], 422);
        }

        try {
            $resp = $this->hub->delete('/by-source/' . $insp->id);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }

        if (!$resp->successful() && $resp->status() !== 404) {
            return $this->forwardError($resp);
        }

        // 即使 hub 上找不到（404）也清本地（数据已不一致，回归正常）
        $insp->update([
            'hub_shared_id'        => null,
            'hub_status'           => null,
            'hub_status_synced_at' => now(),
        ]);

        Log::info('[InspirationHub] withdrew from hub', [
            'local_id' => $insp->id,
            'user_id'  => $user->id,
        ]);

        return response()->json(['ok' => true, 'local_id' => $insp->id]);
    }

    /**
     * POST /api/client/inspiration-hub/{hubId}/report
     * Body: { reason_code, reason_note? }
     * 权限：任何已登录用户即可举报（hub 那边 UNIQUE 兜底防同人重复）
     */
    public function report(Request $request, int $hubId): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'inspiration_hub_not_configured'], 503);
        }

        $validator = Validator::make($request->all(), [
            'reason_code' => ['required', 'string', 'max:30'],
            'reason_note' => ['nullable', 'string', 'max:255'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        try {
            $resp = $this->hub->post('/' . $hubId . '/report', [
                'reason_code' => $request->input('reason_code'),
                'reason_note' => $request->input('reason_note'),
            ]);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }

        return $this->forward($resp);
    }

    // ===========================================================================
    // ===== Admin 层（auth.jwt + admin）
    // ===========================================================================

    /**
     * GET /api/admin/inspiration-hub/settings
     *
     * 只读接口：endpoint / origin 都从云打包配置与当前请求 host 自动推导，
     * 不接受任何手工填写；后台仅用来展示当前生效值 + 接入状态。
     */
    public function adminGetSettings(): JsonResponse
    {
        return response()->json([
            'enabled'  => true,
            'endpoint' => $this->hub->endpoint(),
            'origin'   => $this->hub->origin(),
            // 隔离 client 接口的 503 noise，让管理员看清当前是否就绪
            'ready'    => $this->hub->isReady(),
        ]);
    }

    /**
     * POST /api/admin/inspiration-hub/health-check
     * 实测 endpoint+origin 是否被 hub 接受
     */
    public function adminHealthCheck(): JsonResponse
    {
        return response()->json($this->hub->healthCheck());
    }

    /**
     * GET /api/admin/inspiration-hub/pending-list
     * 透传 hub /pending-list（hub 端会按 is_hub_reviewer 校验，本站非审核员时返 403）
     */
    public function adminPendingList(Request $request): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'inspiration_hub_not_configured'], 503);
        }
        try {
            $resp = $this->hub->get('/pending-list', $request->query());
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        return $this->forward($resp);
    }

    /**
     * POST /api/admin/inspiration-hub/{hubId}/review
     * Body: { action: 'approve'|'reject', reason? }
     */
    public function adminReview(Request $request, int $hubId): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'inspiration_hub_not_configured'], 503);
        }

        $validator = Validator::make($request->all(), [
            'action' => ['required', 'in:approve,reject'],
            'reason' => ['nullable', 'string', 'max:255'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        try {
            $resp = $this->hub->post('/' . $hubId . '/review', [
                'action' => $request->input('action'),
                'reason' => $request->input('reason'),
            ]);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }

        return $this->forward($resp);
    }

    /**
     * POST /api/admin/inspiration-hub/{hubId}/pull-to-local
     * Body: { local_category_id: int }
     *
     * 把 hub 上的灵感拉到本地 inspirations 表。流程：
     *  1. 调 hub GET /{id} 获取详情
     *  2. 校验本地无重复（from_hub_inspiration_id UNIQUE）
     *  3. 在本地 inspirations 表插入一条 status=approved + is_visible=true 的记录
     *  4. cover_image 直接保存 hub 的原 URL（hub 已对此 URL 公开，桌面端能拉到）
     */
    public function adminPullToLocal(Request $request, int $hubId): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'inspiration_hub_not_configured'], 503);
        }

        $validator = Validator::make($request->all(), [
            'local_category_id' => ['required', 'integer', 'exists:inspiration_categories,id'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $existing = Inspiration::where('from_hub_inspiration_id', $hubId)->first(['id']);
        if ($existing) {
            return response()->json([
                'error' => 'already_pulled',
                'local_id' => $existing->id,
            ], 409);
        }

        try {
            $resp = $this->hub->get('/' . $hubId);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }

        if (!$resp->successful()) {
            return $this->forwardError($resp);
        }

        $hubItem = $resp->json();

        // 只允许拉 approved + visible 的
        if (($hubItem['status'] ?? null) !== 'approved' || empty($hubItem['is_visible'])) {
            return response()->json(['error' => 'not_pullable', 'message' => '仅能拉取已通过审核且未下架的灵感'], 422);
        }

        $localCategory = InspirationCategory::find((int) $request->input('local_category_id'));
        if (!$localCategory) {
            return response()->json(['error' => 'invalid_local_category'], 422);
        }

        // hub 返回的 cover_image 是源云控端站点的远程 URL（hub 不转存）。
        // 拉到本地时必须镶像一份到本站存储（local / cos 按 storage_type 自动分流），
        // 避免本站灯感资源被源站可用性包里、跳站热连、签名 URL 过期等问题累及。
        // 镶像失败不阻断拉取。
        $remoteCover = (string) ($hubItem['cover_image'] ?? '');
        $localCover = $this->mirrorRemoteCover($remoteCover);
        $finalCover = $localCover ?? $remoteCover;
        $remoteRefImages = $this->normalizeRefImages($hubItem['ref_images'] ?? []);
        $finalRefImages = $this->mirrorRemoteImages($remoteRefImages);

        $created = Inspiration::create([
            'category_id'              => $localCategory->id,
            'title'                    => (string) ($hubItem['title'] ?? '未命名'),
            'cover_image'              => $finalCover,
            'ref_images'               => $finalRefImages,
            'generation_size'          => $this->normalizeGenerationSize($hubItem['generation_size'] ?? null),
            'prompt_cn'                => (string) ($hubItem['prompt_cn'] ?? ''),
            'prompt_en'                => (string) ($hubItem['prompt_en'] ?? ''),
            'sort_order'               => 0,
            'status'                   => Inspiration::STATUS_APPROVED,
            'is_visible'               => true,
            'from_hub_inspiration_id'  => $hubId,
            'from_hub_source_site_name' => (string) ($hubItem['source_site_name'] ?? ''),
        ]);

        if ($remoteCover !== '' && $localCover === null) {
            Log::warning('[InspirationHub] cover mirror failed, fell back to remote URL', [
                'hub_id'  => $hubId,
                'remote'  => $remoteCover,
            ]);
        }

        Log::info('[InspirationHub] pulled to local', [
            'hub_id'         => $hubId,
            'local_id'       => $created->id,
            'admin_id'       => optional(auth()->user())->id,
            'cover_localized' => $localCover !== null,
        ]);

        // 通知 hub 累加 download_count（即「热度」）。失败容错，不影响主流程：
        // 拉取本身已成功，热度计数失败最多让排行/统计偏低，不应回滚本地记录。
        try {
            $bumpResp = $this->hub->post('/' . $hubId . '/download');
            if (!$bumpResp->successful()) {
                Log::warning('[InspirationHub] bump download_count non-2xx', [
                    'hub_id' => $hubId,
                    'status' => $bumpResp->status(),
                    'body'   => $bumpResp->json(),
                ]);
            }
        } catch (\Throwable $e) {
            Log::warning('[InspirationHub] bump download_count failed', [
                'hub_id' => $hubId,
                'msg'    => $e->getMessage(),
            ]);
        }

        return response()->json([
            'ok' => true,
            'local_id' => $created->id,
            'inspiration' => $created->load('category'),
        ], 201);
    }

    // ===========================================================================
    // ===== 工具方法
    // ===========================================================================

    /**
     * 把 inspirations.cover_image 解析为完整 http(s) URL。
     *  - 已是 http(s) 就直接返回
     *  - 否则当作相对路径，拼 config('app.url')
     */
    private function resolveCoverUrl(string $cover): ?string
    {
        $cover = trim($cover);
        if ($cover === '') return null;
        if (preg_match('#^https?://#i', $cover)) {
            return $cover;
        }
        $base = rtrim((string) config('app.url', ''), '/');
        if ($base === '') return null;
        return $base . '/' . ltrim($cover, '/');
    }

    private function resolveImageUrls(array $images): array
    {
        $urls = [];
        foreach ($images as $image) {
            $url = $this->resolveCoverUrl($image);
            if ($url && preg_match('#^https?://#i', $url)) {
                $urls[] = $url;
            }
        }
        return array_values(array_unique($urls));
    }

    private function normalizeRefImages($value): array
    {
        if (!is_array($value)) {
            return [];
        }
        $items = [];
        foreach ($value as $item) {
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

    private function mirrorRemoteImages(array $remoteUrls): array
    {
        $urls = [];
        foreach (array_slice($remoteUrls, 0, 8) as $remoteUrl) {
            $localUrl = $this->mirrorRemoteCover($remoteUrl);
            $urls[] = $localUrl ?? $remoteUrl;
        }
        return array_values(array_filter($urls, fn ($url) => is_string($url) && trim($url) !== ''));
    }

    private function normalizeGenerationSize($value): ?string
    {
        $size = trim((string) $value);
        return $size === '' ? null : mb_substr($size, 0, 50);
    }

    /**
     * 把 hub 上的远程 cover_image 镶像一份到本站存储。
     *
     * 工作流程：
     *  1. HTTP GET 远程 URL（带 timeout + 跟随重定向 + size 上限）
     *  2. 用 Content-Type 推扩展名（png / jpg / webp / gif），不可识别一律 png
     *  3. 调 StorageService::putBytes 写入 cover_subdir 子目录（local 或 cos 自动分流）
     *  4. 返回新 URL 给 adminPullToLocal 写入 inspirations.cover_image
     *
     * 失败一律返 null（外层用 ?? $remoteCover 兜底，保留原 URL，不阻断拉取）。
     *
     * 注意：与 InspirationController::store / clientUpload 的本地原生上传走同一份 SUBDIR，
     * cover_image 字段最终值的形态完全一致（local 是 /inspirations/<uuid>.<ext>；
     * cos 是完整 https URL），桌面端不需要区分来源。
     */
    private function mirrorRemoteCover(string $remoteUrl): ?string
    {
        $remoteUrl = trim($remoteUrl);
        if ($remoteUrl === '' || !preg_match('#^https?://#i', $remoteUrl)) {
            return null;
        }

        try {
            $resp = Http::timeout(self::COVER_MIRROR_TIMEOUT)
                ->withOptions(['allow_redirects' => true])
                ->get($remoteUrl);
        } catch (\Throwable $e) {
            Log::warning('[InspirationHub] mirrorRemoteCover request failed', [
                'url' => $remoteUrl,
                'err' => $e->getMessage(),
            ]);
            return null;
        }

        if (!$resp->successful()) {
            Log::warning('[InspirationHub] mirrorRemoteCover non-2xx', [
                'url'    => $remoteUrl,
                'status' => $resp->status(),
            ]);
            return null;
        }

        $bytes = $resp->body();
        $size = strlen($bytes);
        if ($size === 0 || $size > self::COVER_MIRROR_MAX_BYTES) {
            Log::warning('[InspirationHub] mirrorRemoteCover invalid size', [
                'url'  => $remoteUrl,
                'size' => $size,
            ]);
            return null;
        }

        // 推断扩展名 + MIME。优先看 Content-Type，缺失/不识别再从 URL 路径回退；
        // 仍不可识别则一律 png（与 InspirationController::uploadFile 的兜底策略一致）。
        $ct = strtolower((string) $resp->header('Content-Type'));
        $ext = match (true) {
            str_contains($ct, 'jpeg'),
            str_contains($ct, 'jpg')   => 'jpg',
            str_contains($ct, 'png')   => 'png',
            str_contains($ct, 'webp')  => 'webp',
            str_contains($ct, 'gif')   => 'gif',
            default => $this->guessCoverExtFromUrl($remoteUrl),
        };
        $contentType = match ($ext) {
            'jpg'  => 'image/jpeg',
            'png'  => 'image/png',
            'webp' => 'image/webp',
            'gif'  => 'image/gif',
            default => 'application/octet-stream',
        };

        $filename = (string) Str::uuid() . '.' . $ext;
        $localUrl = StorageService::putBytes($bytes, $contentType, self::COVER_SUBDIR, $filename);
        if ($localUrl === null) {
            Log::warning('[InspirationHub] mirrorRemoteCover putBytes failed', [
                'url'      => $remoteUrl,
                'storage'  => StorageService::getStorageType(),
                'filename' => $filename,
            ]);
            return null;
        }
        return $localUrl;
    }

    /**
     * 从 URL 路径推断图片扩展名。仅在 Content-Type 不可识别时回退使用。
     */
    private function guessCoverExtFromUrl(string $url): string
    {
        $path = (string) parse_url($url, PHP_URL_PATH);
        $ext = strtolower((string) pathinfo($path, PATHINFO_EXTENSION));
        return match ($ext) {
            'jpg', 'jpeg' => 'jpg',
            'png', 'webp', 'gif' => $ext,
            default => 'png',
        };
    }

    /**
     * 把 hub 返回的 JSON 透传给本地客户端，状态码原样保留。
     * @param  callable|null  $transform  可选的 body 转换器：fn($body) => array
     */
    private function forward(\Illuminate\Http\Client\Response $resp, ?callable $transform = null): JsonResponse
    {
        $body = $resp->json();
        if ($transform && $resp->successful()) {
            $body = $transform($body);
        }
        return response()->json($body, $resp->status());
    }

    private function forwardError(\Illuminate\Http\Client\Response $resp): JsonResponse
    {
        return response()->json($resp->json() ?: ['error' => 'hub_error'], $resp->status());
    }

    private function notReadyReason(): string
    {
        if ($this->hub->endpoint() === '') return 'endpoint_empty';
        if ($this->hub->origin() === '') return 'origin_empty';
        return 'unknown';
    }
}
