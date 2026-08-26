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
 * 智能体共享库对外 API 控制器（云控端调用）。
 *
 * 镜像创意模板共享库（CreativeTemplateHubController），实体改为「智能体」：
 *  - 字段集换成 name / description / avatar / system_prompt / tool_skill_ids /
 *    tool_approval / enable_image_gen / tags，去掉模板专属的 prompt_template /
 *    variables / 参考图等字段，保留分类。
 *  - source_local_id 为字符串（云控端本地智能体 ID 可能非纯数字）。
 *
 * 鉴权：所有端点挂在 domain_binding 中间件后，request->attributes['authorized_client']
 * 由中间件注入；审核员专属端点（pendingList / review）再叠加 hub_reviewer 中间件。
 */
class AgentHubController extends Controller
{
    private const SETTING_GROUP = 'agent_hub';
    private const REASON_CODES = ['invalid_image', 'inappropriate', 'duplicate', 'copyright', 'other'];
    private const TOOL_APPROVALS = ['off', 'destructive', 'all'];

    public function __construct(private SettingService $settings)
    {
    }

    public function me(Request $request): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');
        $todayUsed = DB::table('shared_agents')
            ->where('source_client_id', $client->client_id)
            ->whereDate('created_at', now()->toDateString())
            ->count();

        return response()->json([
            'client_id' => $client->client_id,
            'domain' => $client->domain ?? '',
            'site_name' => $client->owner_name ?? '',
            'is_reviewer' => (bool) ($client->is_hub_reviewer ?? false),
            'approve_threshold' => $this->approveThreshold(),
            'reject_threshold' => $this->rejectThreshold(),
            'report_threshold' => $this->reportThreshold(),
            'submit_daily_limit' => $this->submitDailyLimit(),
            'submit_daily_used' => $todayUsed,
        ]);
    }

    public function categories(): JsonResponse
    {
        $rows = DB::table('shared_agent_categories')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get(['id', 'name', 'slug', 'sort_order']);

        return response()->json(['data' => $rows]);
    }

    public function list(Request $request): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');
        $perPage = min(60, max(1, (int) $request->query('per_page', 20)));
        $page = max(1, (int) $request->query('page', 1));

        $q = DB::table('shared_agents as a')
            ->leftJoin('shared_agent_categories as c', 'a.category_id', '=', 'c.id')
            ->where('a.status', 'approved')
            ->where('a.is_visible', true);

        if ($request->filled('category_id')) {
            $q->where('a.category_id', (int) $request->input('category_id'));
        }
        if ($request->filled('search')) {
            $kw = '%' . trim((string) $request->input('search')) . '%';
            $q->where(function ($w) use ($kw) {
                $w->where('a.name', 'like', $kw)
                    ->orWhere('a.description', 'like', $kw)
                    ->orWhere('a.system_prompt', 'like', $kw);
            });
        }
        if ($request->boolean('exclude_self')) {
            $q->where('a.source_client_id', '!=', $client->client_id);
        }

        $total = (clone $q)->count();
        $sort = (string) $request->query('sort', 'recent');
        if ($sort === 'popular') {
            $q->orderByDesc('a.download_count')->orderByDesc('a.id');
        } else {
            $q->orderByDesc('a.id');
        }
        $rows = $q
            ->skip(($page - 1) * $perPage)
            ->take($perPage)
            ->get([
                'a.id', 'a.category_id', 'c.name as category_name', 'c.slug as category_slug',
                'a.name', 'a.description', 'a.avatar', 'a.system_prompt', 'a.tool_skill_ids',
                'a.tool_approval', 'a.enable_image_gen', 'a.tags', 'a.source_metadata',
                'a.source_site_name', 'a.download_count', 'a.report_count', 'a.created_at',
            ]);

        $ids = $rows->pluck('id')->all();
        $myReports = empty($ids) ? [] : DB::table('shared_agent_reports')
            ->whereIn('shared_id', $ids)
            ->where('reporter_client_id', $client->client_id)
            ->pluck('shared_id')
            ->all();
        $myReportSet = array_flip($myReports);

        $items = $rows->map(function ($row) use ($myReportSet) {
            $this->decodeAgentJsonFields($row);
            $row->reported_by_me = isset($myReportSet[$row->id]);
            return $row;
        });

        return response()->json([
            'items' => $items,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
        ]);
    }

    public function show(Request $request, int $id): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');
        $row = DB::table('shared_agents as a')
            ->leftJoin('shared_agent_categories as c', 'a.category_id', '=', 'c.id')
            ->where('a.id', $id)
            ->first(['a.*', 'c.name as category_name', 'c.slug as category_slug']);
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $isOwner = $row->source_client_id === $client->client_id;
        $isReviewer = (bool) ($client->is_hub_reviewer ?? false);
        $publiclyVisible = $row->status === 'approved' && (int) $row->is_visible === 1;
        if (!$publiclyVisible && !$isOwner && !($isReviewer && $row->status === 'pending')) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $myReview = DB::table('shared_agent_reviews')
            ->where('shared_id', $id)
            ->where('reviewer_client_id', $client->client_id)
            ->first(['action', 'reason', 'created_at']);
        $reportedByMe = DB::table('shared_agent_reports')
            ->where('shared_id', $id)
            ->where('reporter_client_id', $client->client_id)
            ->exists();

        $this->decodeAgentJsonFields($row);
        $row->my_review_action = $myReview ? $myReview->action : null;
        $row->my_review_reason = $myReview ? $myReview->reason : null;
        $row->reported_by_me = $reportedByMe;

        if ($row->status === 'rejected') {
            $latestReject = DB::table('shared_agent_reviews')
                ->where('shared_id', $id)
                ->where('action', 'reject')
                ->orderByDesc('created_at')
                ->first(['reason']);
            $row->latest_reject_reason = $latestReject ? $latestReject->reason : null;
        }

        return response()->json($row);
    }

    public function submit(Request $request): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');
        $validator = Validator::make($request->all(), [
            'hub_category_id' => ['required', 'integer'],
            'name' => ['required', 'string', 'max:100'],
            'description' => ['nullable', 'string', 'max:500'],
            'system_prompt' => ['nullable', 'string', 'max:20000'],
            'tool_skill_ids' => ['nullable'],
            'tool_approval' => ['nullable', 'string', 'in:' . implode(',', self::TOOL_APPROVALS)],
            'enable_image_gen' => ['nullable', 'boolean'],
            'tags' => ['nullable'],
            'avatar' => ['nullable', 'image', 'max:4096'],
            'avatar_url' => ['nullable', 'url', 'max:500'],
            'source_metadata' => ['nullable', 'array'],
            'source_local_id' => ['required', 'string', 'max:64'],
            'source_site_name' => ['nullable', 'string', 'max:100'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $categoryExists = DB::table('shared_agent_categories')
            ->where('id', $request->input('hub_category_id'))
            ->exists();
        if (!$categoryExists) {
            return response()->json(['error' => 'invalid_hub_category'], 422);
        }

        // 头像：上传文件优先（存 public 盘返回公网 URL），否则用 avatar_url 直存（镜像创意模板 cover_image）
        $avatar = $this->resolveAvatar($request);
        if ($avatar === null) {
            return response()->json([
                'error' => 'validation_failed',
                'details' => ['avatar' => ['请上传头像文件或提供 avatar_url']],
            ], 422);
        }

        $sourceLocalId = trim((string) $request->input('source_local_id'));
        $duplicate = DB::table('shared_agents')
            ->where('source_client_id', $client->client_id)
            ->where('source_local_id', $sourceLocalId)
            ->first(['id', 'status']);
        if ($duplicate) {
            return response()->json([
                'error' => 'already_shared',
                'shared_id' => $duplicate->id,
                'status' => $duplicate->status,
            ], 409);
        }

        if (!HubReviewerSubmitPolicy::bypassDailyLimit($client)) {
            $dailyLimit = $this->submitDailyLimit();
            $todayUsed = DB::table('shared_agents')
                ->where('source_client_id', $client->client_id)
                ->whereDate('created_at', now()->toDateString())
                ->count();
            if ($todayUsed >= $dailyLimit) {
                return response()->json([
                    'error' => 'submit_quota_exceeded',
                    'daily_used' => $todayUsed,
                    'daily_limit' => $dailyLimit,
                ], 429);
            }
        }

        $now = now();
        $status = HubReviewerSubmitPolicy::initialStatus($client);
        $toolSkillIds = $this->normalizeStringArray($this->parseArrayInput($request->input('tool_skill_ids', [])), 50);
        $tags = $this->normalizeStringArray($this->parseArrayInput($request->input('tags', [])), 20);
        $sourceMetadata = $this->normalizeMetadata($request->input('source_metadata', []));
        $sharedId = DB::table('shared_agents')->insertGetId([
            'category_id' => (int) $request->input('hub_category_id'),
            'name' => trim((string) $request->input('name')),
            'description' => trim((string) $request->input('description', '')),
            'avatar' => $avatar,
            'system_prompt' => $this->normalizeSystemPrompt($request->input('system_prompt')),
            'tool_skill_ids' => empty($toolSkillIds) ? null : json_encode($toolSkillIds, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'tool_approval' => $this->normalizeToolApproval($request->input('tool_approval')),
            'enable_image_gen' => $request->boolean('enable_image_gen'),
            'tags' => empty($tags) ? null : json_encode($tags, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'source_metadata' => empty($sourceMetadata) ? null : json_encode($sourceMetadata, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'source_client_id' => $client->client_id,
            'source_local_id' => $sourceLocalId,
            'source_site_name' => trim((string) $request->input('source_site_name', '')),
            'status' => $status,
            'reviewed_at' => $status === 'approved' ? $now : null,
            'is_visible' => true,
            'approve_count' => 0,
            'reject_count' => 0,
            'report_count' => 0,
            'download_count' => 0,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        Log::info('[AgentHub] submitted', [
            'shared_id' => $sharedId,
            'source_client_id' => $client->client_id,
            'source_local_id' => $sourceLocalId,
        ]);

        return response()->json(['shared_id' => $sharedId, 'status' => $status], 201);
    }

    public function download(Request $request, int $id): JsonResponse
    {
        $row = DB::table('shared_agents')->where('id', $id)->first(['id', 'status', 'is_visible']);
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }
        if ($row->status !== 'approved' || (int) $row->is_visible !== 1) {
            return response()->json(['error' => 'not_available'], 409);
        }
        DB::table('shared_agents')->where('id', $id)->increment('download_count');
        return response()->json(['ok' => true]);
    }

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

        $threshold = $this->reportThreshold();
        try {
            DB::transaction(function () use ($id, $client, $request, $threshold) {
                $locked = DB::table('shared_agents')->where('id', $id)->lockForUpdate()->first();
                if (!$locked) {
                    abort(404);
                }
                DB::table('shared_agent_reports')->insert([
                    'shared_id' => $id,
                    'reporter_client_id' => $client->client_id,
                    'reason_code' => $request->input('reason_code'),
                    'reason_note' => $request->input('reason_note'),
                    'created_at' => now(),
                ]);
                DB::table('shared_agents')->where('id', $id)->increment('report_count');
                $latest = DB::table('shared_agents')->where('id', $id)->first(['report_count', 'is_visible']);
                if ($latest && $latest->report_count >= $threshold && (int) $latest->is_visible === 1) {
                    DB::table('shared_agents')->where('id', $id)->update([
                        'is_visible' => false,
                        'auto_hidden_at' => now(),
                        'updated_at' => now(),
                    ]);
                }
            });
        } catch (\Illuminate\Database\QueryException $e) {
            if (($e->errorInfo[1] ?? null) === 1062) {
                return response()->json(['error' => 'already_reported'], 409);
            }
            throw $e;
        }

        $latest = DB::table('shared_agents')->where('id', $id)->first(['report_count', 'is_visible', 'auto_hidden_at']);
        return response()->json([
            'ok' => true,
            'report_count' => (int) $latest->report_count,
            'is_visible' => (bool) $latest->is_visible,
            'auto_hidden' => $latest->auto_hidden_at !== null,
            'threshold' => $threshold,
        ]);
    }

    public function statusBatch(Request $request): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');
        $validator = Validator::make($request->all(), [
            'shared_ids' => ['required', 'array', 'min:1', 'max:100'],
            'shared_ids.*' => ['required', 'integer', 'min:1'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $ids = array_values(array_unique($request->input('shared_ids')));
        $rows = DB::table('shared_agents')
            ->whereIn('id', $ids)
            ->where('source_client_id', $client->client_id)
            ->get([
                'id', 'source_local_id', 'status', 'is_visible', 'approve_count', 'reject_count',
                'report_count', 'auto_hidden_at', 'updated_at',
            ]);

        $rejectedIds = $rows->where('status', 'rejected')->pluck('id')->all();
        $rejectReasonMap = [];
        if (!empty($rejectedIds)) {
            $latestRejects = DB::table('shared_agent_reviews as r1')
                ->whereIn('r1.shared_id', $rejectedIds)
                ->where('r1.action', 'reject')
                ->whereNotExists(function ($q) {
                    $q->select(DB::raw(1))
                        ->from('shared_agent_reviews as r2')
                        ->whereColumn('r2.shared_id', 'r1.shared_id')
                        ->where('r2.action', 'reject')
                        ->whereColumn('r2.created_at', '>', 'r1.created_at');
                })
                ->get(['r1.shared_id', 'r1.reason']);
            foreach ($latestRejects as $item) {
                $rejectReasonMap[$item->shared_id] = $item->reason;
            }
        }

        return response()->json([
            'items' => $rows->map(function ($row) use ($rejectReasonMap) {
                $row->latest_reject_reason = $rejectReasonMap[$row->id] ?? null;
                return $row;
            }),
        ]);
    }

    public function withdrawBySource(Request $request, string $localId): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');
        $row = DB::table('shared_agents')
            ->where('source_client_id', $client->client_id)
            ->where('source_local_id', $localId)
            ->first(['id']);
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }
        DB::table('shared_agents')->where('id', $row->id)->delete();
        Log::info('[AgentHub] withdrew', [
            'shared_id' => $row->id,
            'source_client_id' => $client->client_id,
            'source_local_id' => $localId,
        ]);
        return response()->json(['ok' => true, 'withdrawn_id' => $row->id]);
    }

    public function pendingList(Request $request): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');
        $perPage = min(60, max(1, (int) $request->query('per_page', 20)));
        $page = max(1, (int) $request->query('page', 1));

        $q = DB::table('shared_agents as a')
            ->leftJoin('shared_agent_categories as c', 'a.category_id', '=', 'c.id')
            ->where('a.status', 'pending');
        if ($request->filled('category_id')) {
            $q->where('a.category_id', (int) $request->input('category_id'));
        }

        $total = (clone $q)->count();
        $rows = $q->orderBy('a.created_at')
            ->skip(($page - 1) * $perPage)
            ->take($perPage)
            ->get([
                'a.id', 'a.category_id', 'c.name as category_name', 'c.slug as category_slug',
                'a.name', 'a.description', 'a.avatar', 'a.system_prompt', 'a.tool_skill_ids',
                'a.tool_approval', 'a.enable_image_gen', 'a.tags', 'a.source_metadata',
                'a.source_site_name', 'a.approve_count', 'a.reject_count', 'a.created_at',
            ]);

        $ids = $rows->pluck('id')->all();
        $myVotes = empty($ids) ? [] : DB::table('shared_agent_reviews')
            ->whereIn('shared_id', $ids)
            ->where('reviewer_client_id', $client->client_id)
            ->get(['shared_id', 'action'])
            ->keyBy('shared_id')
            ->map->action
            ->all();

        $items = $rows->map(function ($row) use ($myVotes) {
            $this->decodeAgentJsonFields($row);
            $row->my_review_action = $myVotes[$row->id] ?? null;
            return $row;
        });

        return response()->json([
            'items' => $items,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
            'approve_threshold' => $this->approveThreshold(),
            'reject_threshold' => $this->rejectThreshold(),
        ]);
    }

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

        $action = (string) $request->input('action');
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
                $locked = DB::table('shared_agents')->where('id', $id)->lockForUpdate()->first();
                if (!$locked) {
                    abort(404);
                }
                if ($locked->status !== 'pending') {
                    return ['error' => 'already_settled', 'status' => $locked->status];
                }
                DB::table('shared_agent_reviews')->insert([
                    'shared_id' => $id,
                    'reviewer_client_id' => $client->client_id,
                    'action' => $action,
                    'reason' => $reason !== '' ? $reason : null,
                    'created_at' => now(),
                ]);
                DB::table('shared_agents')
                    ->where('id', $id)
                    ->increment($action === 'approve' ? 'approve_count' : 'reject_count');
                $latest = DB::table('shared_agents')->where('id', $id)->first(['approve_count', 'reject_count']);
                if ($latest->reject_count >= $rejectThreshold) {
                    DB::table('shared_agents')->where('id', $id)->update([
                        'status' => 'rejected',
                        'reviewed_at' => now(),
                        'updated_at' => now(),
                    ]);
                    return ['settled' => 'rejected'];
                }
                if ($latest->approve_count >= $approveThreshold) {
                    DB::table('shared_agents')->where('id', $id)->update([
                        'status' => 'approved',
                        'reviewed_at' => now(),
                        'updated_at' => now(),
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

        $latest = DB::table('shared_agents')->where('id', $id)->first(['status', 'approve_count', 'reject_count']);
        return response()->json([
            'ok' => true,
            'my_action' => $action,
            'shared_status' => $latest->status,
            'approve_count' => (int) $latest->approve_count,
            'reject_count' => (int) $latest->reject_count,
            'approve_threshold' => $approveThreshold,
            'reject_threshold' => $rejectThreshold,
            'settled' => $finalStatus['settled'] ?? null,
        ]);
    }

    private function approveThreshold(): int
    {
        return max(1, (int) $this->settings->get(self::SETTING_GROUP, 'approve_threshold', 3));
    }

    private function rejectThreshold(): int
    {
        return max(1, (int) $this->settings->get(self::SETTING_GROUP, 'reject_threshold', 3));
    }

    private function reportThreshold(): int
    {
        return max(1, (int) $this->settings->get(self::SETTING_GROUP, 'report_threshold', 5));
    }

    private function submitDailyLimit(): int
    {
        return max(1, (int) $this->settings->get(self::SETTING_GROUP, 'submit_daily_limit', 50));
    }

    private function resolveAvatar(Request $request): ?string
    {
        if ($request->hasFile('avatar')) {
            $file = $request->file('avatar');
            if ($file && $file->isValid()) {
                // 存到 public 盘（storage/app/public），经 storage:link 软链对外暴露为 /storage/...
                $path = $file->store('shared-agents/avatars', 'public');
                if (is_string($path) && $path !== '') {
                    return asset('storage/' . ltrim($path, '/'));
                }
            }
        }
        $url = trim((string) $request->input('avatar_url', ''));
        return $url !== '' ? $url : null;
    }

    private function decodeAgentJsonFields(object $row): void
    {
        $row->tool_skill_ids = $this->decodeStringArray($row->tool_skill_ids ?? null, 50);
        $row->tags = $this->decodeStringArray($row->tags ?? null, 20);
        $row->source_metadata = $this->decodeMetadata($row->source_metadata ?? null);
    }

    private function parseArrayInput($value): array
    {
        if (is_array($value)) {
            return $value;
        }
        if (is_string($value) && trim($value) !== '') {
            $decoded = json_decode($value, true);
            return is_array($decoded) ? $decoded : [];
        }
        return [];
    }

    private function decodeStringArray($value, int $max = 50): array
    {
        if (is_array($value)) {
            return $this->normalizeStringArray($value, $max);
        }
        if (!is_string($value) || trim($value) === '') {
            return [];
        }
        $decoded = json_decode($value, true);
        return $this->normalizeStringArray(is_array($decoded) ? $decoded : [], $max);
    }

    private function normalizeStringArray($value, int $max = 50): array
    {
        if (!is_array($value)) {
            return [];
        }
        $items = [];
        foreach (array_slice($value, 0, $max) as $item) {
            if (is_array($item)) {
                continue;
            }
            $str = trim((string) $item);
            if ($str !== '') {
                $items[] = $str;
            }
        }
        return array_values(array_unique($items));
    }

    private function decodeMetadata($value): array
    {
        if (is_array($value)) {
            return $this->normalizeMetadata($value);
        }
        if (!is_string($value) || trim($value) === '') {
            return [];
        }
        $decoded = json_decode($value, true);
        return $this->normalizeMetadata(is_array($decoded) ? $decoded : []);
    }

    private function normalizeMetadata($value): array
    {
        if (!is_array($value)) {
            return [];
        }
        return array_slice($value, 0, 30, true);
    }

    private function normalizeSystemPrompt($value): ?string
    {
        $prompt = trim((string) $value);
        return $prompt === '' ? null : $prompt;
    }

    private function normalizeToolApproval($value): string
    {
        $value = (string) $value;
        return in_array($value, self::TOOL_APPROVALS, true) ? $value : 'destructive';
    }
}
