<?php

namespace App\Http\Controllers;

use App\Models\Agent;
use App\Models\AgentCategory;
use App\Models\AgentPurchase;
use App\Models\AgentRating;
use App\Models\AgentVisibility;
use App\Models\SystemSetting;
use App\Services\BalanceService;
use App\Services\StorageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class AgentController extends Controller
{
    private const SUBDIR = 'agents';
    private const MAX_BYTES = 3 * 1024 * 1024;
    // 2:3 竖图：h/w = 1.5；允许 ±0.1 容差（覆盖裁剪误差）
    private const ASPECT_TARGET = 1.5;
    private const ASPECT_TOLERANCE = 0.1;

    // ============== Admin: 分类 CRUD ==============

    public function categoryIndex(): JsonResponse
    {
        $categories = AgentCategory::withCount('agents')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();

        return response()->json(['data' => $categories]);
    }

    public function categoryStore(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'name' => ['required', 'string', 'max:50'],
            'description' => ['nullable', 'string', 'max:500'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
            'is_visible' => ['nullable', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $category = AgentCategory::create([
            'name' => (string) $request->input('name', ''),
            // description 列是 NOT NULL DEFAULT ''；前端可能传 null，必须 cast，否则触发 SQL 1048
            'description' => (string) ($request->input('description') ?? ''),
            'sort_order' => (int) ($request->input('sort_order') ?? 0),
            'is_visible' => $request->has('is_visible') ? $request->boolean('is_visible') : true,
        ]);

        return response()->json($category, 201);
    }

    public function categoryUpdate(Request $request, int $id): JsonResponse
    {
        $category = AgentCategory::find($id);
        if (!$category) return response()->json(['error' => 'not_found'], 404);

        $validator = Validator::make($request->all(), [
            'name' => ['required', 'string', 'max:50'],
            'description' => ['nullable', 'string', 'max:500'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
            'is_visible' => ['nullable', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $category->update([
            'name' => (string) $request->input('name', $category->name),
            // 同 categoryStore：description NOT NULL，强制 cast 兜底
            'description' => (string) ($request->input('description') ?? ''),
            'sort_order' => (int) ($request->input('sort_order') ?? $category->sort_order),
            'is_visible' => $request->has('is_visible') ? $request->boolean('is_visible') : $category->is_visible,
        ]);

        return response()->json($category);
    }

    public function categoryDestroy(int $id): JsonResponse
    {
        $category = AgentCategory::find($id);
        if (!$category) return response()->json(['error' => 'not_found'], 404);
        // category_id 可空且无外键级联：删除分类时把成员智能体置为未分类，避免悬空引用
        Agent::where('category_id', $category->id)->update(['category_id' => null]);
        $category->delete();
        return response()->json(['ok' => true]);
    }

    // ============== Admin: 列表 / 详情 ==============

    public function index(Request $request): JsonResponse
    {
        $query = Agent::with(['category', 'submittedBy', 'visibilities', 'knowledgeBases:id,name'])
            ->orderBy('sort_order')
            ->orderByDesc('id');

        if ($request->filled('category_id')) {
            $query->where('category_id', $request->input('category_id'));
        }
        if ($request->filled('is_visible') && $request->input('is_visible') !== '') {
            $query->where('is_visible', $request->boolean('is_visible'));
        }
        if ($request->filled('submission_status')) {
            $query->where('submission_status', $request->input('submission_status'));
        }
        if ($request->filled('source_type')) {
            $query->where('source_type', $request->input('source_type'));
        }
        if ($request->filled('uploader_keyword')) {
            $k = (string) $request->input('uploader_keyword');
            $query->where(function ($q) use ($k) {
                $q->where('submitted_by_nickname', 'like', "%{$k}%")
                    ->orWhereIn('submitted_by_user_id', function ($sub) use ($k) {
                        $sub->select('id')->from('users')
                            ->where('username', 'like', "%{$k}%")
                            ->orWhere('nickname', 'like', "%{$k}%");
                    });
            });
        }
        if ($request->filled('search')) {
            $s = (string) $request->input('search');
            $query->where(function ($q) use ($s) {
                $q->where('name', 'like', "%{$s}%")
                    ->orWhere('description', 'like', "%{$s}%");
            });
        }

        $perPage = min((int) $request->input('per_page', 20), 100);
        return response()->json($query->paginate($perPage));
    }

    public function show(int $id): JsonResponse
    {
        $agent = Agent::with(['category', 'submittedBy', 'visibilities', 'knowledgeBases:id,name'])->find($id);
        if (!$agent) return response()->json(['error' => 'not_found'], 404);
        return response()->json($agent);
    }

    // ============== Admin: 创建 / 编辑 / 删除 ==============

    public function store(Request $request): JsonResponse
    {
        $validator = $this->agentValidator($request, true);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }
        if ($request->hasFile('avatar')) {
            $aspectErr = $this->validateAvatarAspect($request->file('avatar'));
            if ($aspectErr) {
                return response()->json(['error' => 'validation_failed', 'details' => ['avatar' => [$aspectErr]]], 422);
            }
        }

        $avatarUrl = $request->hasFile('avatar')
            ? $this->uploadFile($request->file('avatar'))
            : (string) $request->input('avatar_url', '');
        if ($avatarUrl === null) {
            return response()->json(['error' => 'upload_failed'], 500);
        }
        $avatarThumb = $request->hasFile('avatar_thumb') ? (string) $this->uploadFile($request->file('avatar_thumb')) : '';

        $user = auth()->user();
        $now = now();
        $agent = Agent::create([
            'category_id' => $request->filled('category_id') ? (int) $request->input('category_id') : null,
            'name' => (string) $request->input('name'),
            'description' => (string) ($request->input('description') ?? ''),
            'avatar' => $avatarUrl ?: '',
            'avatar_thumb' => $avatarThumb,
            'system_prompt' => (string) ($request->input('system_prompt') ?? ''),
            'template_schema_version' => 1,
            'template_version' => max(1, (int) ($request->input('template_version') ?? 1)),
            'role_profile' => $this->sanitizeRoleProfile($request->input('role_profile')),
            'workflow_templates' => $this->sanitizeTemplateList($request->input('workflow_templates')),
            'acceptance_templates' => $this->sanitizeTemplateList($request->input('acceptance_templates')),
            'recommended_skill_dirs' => $this->sanitizeStringList($request->input('recommended_skill_dirs'), 50, 120),
            'connector_requirements' => $this->sanitizeStringList($request->input('connector_requirements'), 50, 120),
            'tool_skill_ids' => $this->sanitizeToolSkillIds($request->input('tool_skill_ids')),
            'tool_approval' => $this->normalizeToolApproval($request->input('tool_approval')),
            'enable_image_gen' => $request->boolean('enable_image_gen'),
            'kb_only' => $request->boolean('kb_only'),
            'kb_top_k' => $this->normalizeKbTopK($request->input('kb_top_k')),
            'tags' => $this->sanitizeTags($request->input('tags')),
            'sort_order' => (int) ($request->input('sort_order') ?? 0),
            'is_visible' => $request->has('is_visible') ? $request->boolean('is_visible') : true,
            'price' => $this->normalizePrice($request->input('price')),
            'price_balance_type' => $this->normalizeBalanceType($request->input('price_balance_type')),
            'visibility_scope' => $request->input('visibility_scope') === Agent::VISIBILITY_RESTRICTED ? Agent::VISIBILITY_RESTRICTED : Agent::VISIBILITY_PUBLIC,
            // 管理员直建：直接通过审核
            'submission_status' => Agent::STATUS_APPROVED,
            'source_type' => Agent::SOURCE_ADMIN,
            'reviewed_by_user_id' => optional($user)->id,
            'reviewed_at' => $now,
            'published_at' => $now,
            'created_by_user_id' => optional($user)->id,
        ]);

        $this->syncVisibilities($agent, $request);
        $this->syncKnowledgeBases($agent, $request);

        return response()->json($agent->load(['visibilities', 'knowledgeBases:id,name']), 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $agent = Agent::find($id);
        if (!$agent) return response()->json(['error' => 'not_found'], 404);

        $validator = $this->agentValidator($request, false);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }
        if ($request->hasFile('avatar')) {
            $aspectErr = $this->validateAvatarAspect($request->file('avatar'));
            if ($aspectErr) {
                return response()->json(['error' => 'validation_failed', 'details' => ['avatar' => [$aspectErr]]], 422);
            }
        }

        $data = [];
        if ($request->has('category_id')) $data['category_id'] = $request->filled('category_id') ? (int) $request->input('category_id') : null;
        if ($request->has('name')) $data['name'] = (string) $request->input('name');
        if ($request->has('description')) $data['description'] = (string) ($request->input('description') ?? '');
        if ($request->has('system_prompt')) $data['system_prompt'] = (string) ($request->input('system_prompt') ?? '');
        if ($request->has('template_version')) $data['template_version'] = max(1, (int) $request->input('template_version'));
        if ($request->has('role_profile')) $data['role_profile'] = $this->sanitizeRoleProfile($request->input('role_profile'));
        if ($request->has('workflow_templates')) $data['workflow_templates'] = $this->sanitizeTemplateList($request->input('workflow_templates'));
        if ($request->has('acceptance_templates')) $data['acceptance_templates'] = $this->sanitizeTemplateList($request->input('acceptance_templates'));
        if ($request->has('recommended_skill_dirs')) $data['recommended_skill_dirs'] = $this->sanitizeStringList($request->input('recommended_skill_dirs'), 50, 120);
        if ($request->has('connector_requirements')) $data['connector_requirements'] = $this->sanitizeStringList($request->input('connector_requirements'), 50, 120);
        if ($request->has('tool_skill_ids')) $data['tool_skill_ids'] = $this->sanitizeToolSkillIds($request->input('tool_skill_ids'));
        if ($request->has('tool_approval')) $data['tool_approval'] = $this->normalizeToolApproval($request->input('tool_approval'));
        if ($request->has('enable_image_gen')) $data['enable_image_gen'] = $request->boolean('enable_image_gen');
        if ($request->has('kb_only')) $data['kb_only'] = $request->boolean('kb_only');
        if ($request->has('kb_top_k')) $data['kb_top_k'] = $this->normalizeKbTopK($request->input('kb_top_k'));
        if ($request->has('tags')) $data['tags'] = $this->sanitizeTags($request->input('tags'));
        if ($request->has('sort_order')) $data['sort_order'] = (int) ($request->input('sort_order') ?? 0);
        if ($request->has('is_visible')) $data['is_visible'] = $request->boolean('is_visible');
        if ($request->has('price')) $data['price'] = $this->normalizePrice($request->input('price'));
        if ($request->has('price_balance_type')) $data['price_balance_type'] = $this->normalizeBalanceType($request->input('price_balance_type'));
        if ($request->has('visibility_scope')) $data['visibility_scope'] = $request->input('visibility_scope') === Agent::VISIBILITY_RESTRICTED ? Agent::VISIBILITY_RESTRICTED : Agent::VISIBILITY_PUBLIC;

        if ($request->hasFile('avatar')) {
            $newUrl = $this->uploadFile($request->file('avatar'));
            if ($newUrl === null) return response()->json(['error' => 'upload_failed'], 500);
            if ($agent->avatar && $agent->avatar !== $newUrl) {
                $this->deleteAgentStorageFile((string) $agent->avatar);
            }
            $data['avatar'] = $newUrl;
            $newThumb = $request->hasFile('avatar_thumb') ? (string) $this->uploadFile($request->file('avatar_thumb')) : '';
            if ($agent->avatar_thumb && $agent->avatar_thumb !== $newThumb) {
                $this->deleteAgentStorageFile((string) $agent->avatar_thumb);
            }
            $data['avatar_thumb'] = $newThumb;
        } elseif ($request->input('remove_avatar') === '1') {
            if ($agent->avatar) $this->deleteAgentStorageFile((string) $agent->avatar);
            $data['avatar'] = '';
            if ($agent->avatar_thumb) $this->deleteAgentStorageFile((string) $agent->avatar_thumb);
            $data['avatar_thumb'] = '';
        }

        $agent->update($data);
        $this->syncVisibilities($agent->refresh(), $request);
        $this->syncKnowledgeBases($agent, $request);
        return response()->json($agent->load(['category', 'submittedBy', 'visibilities', 'knowledgeBases:id,name']));
    }

    public function destroy(int $id): JsonResponse
    {
        $agent = Agent::find($id);
        if (!$agent) return response()->json(['error' => 'not_found'], 404);
        if ($agent->avatar) $this->deleteAgentStorageFile((string) $agent->avatar);
        if ($agent->avatar_thumb) $this->deleteAgentStorageFile((string) $agent->avatar_thumb);
        $agent->delete();
        return response()->json(['ok' => true]);
    }

    public function batchDestroy(Request $request): JsonResponse
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', (array) $request->input('ids', [])))));
        if (!$ids) return response()->json(['error' => 'ids 不能为空'], 400);
        if (count($ids) > 200) return response()->json(['error' => '单次批量操作不超过 200 条'], 400);

        $deleted = 0;
        foreach (Agent::whereIn('id', $ids)->get() as $agent) {
            if ($agent->avatar) $this->deleteAgentStorageFile((string) $agent->avatar);
            if ($agent->avatar_thumb) $this->deleteAgentStorageFile((string) $agent->avatar_thumb);
            $agent->delete();
            $deleted++;
        }
        return response()->json(['deleted' => $deleted, 'total' => count($ids)]);
    }

    // ============== Admin: 启停（单个 + 批量）==============

    public function setVisibility(Request $request, int $id): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'is_visible' => ['required', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $agent = Agent::find($id);
        if (!$agent) return response()->json(['error' => 'not_found'], 404);
        if ($request->boolean('is_visible') && $agent->submission_status !== Agent::STATUS_APPROVED) {
            return response()->json(['error' => 'not_approved', 'message' => '仅审核通过的智能体可以上架'], 409);
        }
        $agent->update(['is_visible' => $request->boolean('is_visible')]);
        return response()->json($agent->load('submittedBy'));
    }

    public function batchSetVisibility(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'ids' => ['required', 'array', 'min:1', 'max:200'],
            'ids.*' => ['integer'],
            'is_visible' => ['required', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $visible = $request->boolean('is_visible');
        $query = Agent::whereIn('id', $request->input('ids'));
        // 上架时只能上架已审核通过的；下架无限制
        if ($visible) {
            $query->where('submission_status', Agent::STATUS_APPROVED);
        }
        $affected = $query->update(['is_visible' => $visible]);
        return response()->json(['ok' => true, 'affected' => $affected]);
    }

    public function setSortOrder(Request $request, int $id): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'sort_order' => ['required', 'integer', 'min:0', 'max:999999'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }
        $agent = Agent::find($id);
        if (!$agent) return response()->json(['error' => 'not_found'], 404);
        $agent->update(['sort_order' => (int) $request->input('sort_order', 0)]);
        return response()->json($agent->load('submittedBy'));
    }

    // ============== Admin: 审核（投稿）==============

    public function approve(int $id): JsonResponse
    {
        $agent = Agent::find($id);
        if (!$agent) return response()->json(['error' => 'not_found'], 404);
        if ($agent->submission_status === Agent::STATUS_WITHDRAWN) {
            return response()->json(['error' => 'withdrawn', 'message' => '已撤回的智能体不能通过审核'], 409);
        }
        $agent->update([
            'submission_status' => Agent::STATUS_APPROVED,
            'is_visible' => true,
            'reviewed_by_user_id' => optional(auth()->user())->id,
            'reviewed_at' => now(),
            'reject_reason' => '',
            'published_at' => $agent->published_at ?: now(),
        ]);
        return response()->json($agent->load('submittedBy'));
    }

    public function reject(Request $request, int $id): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'reason' => ['nullable', 'string', 'max:500'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }
        $agent = Agent::find($id);
        if (!$agent) return response()->json(['error' => 'not_found'], 404);
        $agent->update([
            'submission_status' => Agent::STATUS_REJECTED,
            'is_visible' => false,
            'reviewed_by_user_id' => optional(auth()->user())->id,
            'reviewed_at' => now(),
            'reject_reason' => (string) $request->input('reason', ''),
        ]);
        return response()->json($agent->load('submittedBy'));
    }

    // ============== Client: 桌面端投稿 / 状态 / 撤回 ==============

    public function clientSubmit(Request $request): JsonResponse
    {
        $user = auth()->user();
        if (!$user) return response()->json(['error' => 'unauthenticated'], 401);

        $validator = $this->agentValidator($request, true);
        $validator->addRules([
            'local_agent_id' => ['required', 'string', 'max:100'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }
        if ($request->hasFile('avatar')) {
            $aspectErr = $this->validateAvatarAspect($request->file('avatar'));
            if ($aspectErr) {
                return response()->json(['error' => 'validation_failed', 'details' => ['avatar' => [$aspectErr]]], 422);
            }
        }

        $localId = (string) $request->input('local_agent_id');
        $existing = Agent::where('submitted_by_user_id', $user->id)
            ->where('source_local_agent_id', $localId)
            ->whereIn('submission_status', [Agent::STATUS_PENDING, Agent::STATUS_APPROVED])
            ->first();
        if ($existing) {
            return response()->json([
                'error' => 'already_submitted',
                'cloud_agent_id' => $existing->id,
                'submission_status' => $existing->submission_status,
            ], 409);
        }

        $avatarUrl = $request->hasFile('avatar')
            ? $this->uploadFile($request->file('avatar'))
            : (string) $request->input('avatar_url', '');
        if ($avatarUrl === null) {
            return response()->json(['error' => 'upload_failed'], 500);
        }
        $avatarThumb = $request->hasFile('avatar_thumb') ? (string) $this->uploadFile($request->file('avatar_thumb')) : '';

        $skipAudit = (bool) SystemSetting::getValue('agent_skip_audit', false);
        $status = $skipAudit ? Agent::STATUS_APPROVED : Agent::STATUS_PENDING;
        $now = now();

        $agent = Agent::create([
            'name' => (string) $request->input('name'),
            'description' => (string) ($request->input('description') ?? ''),
            'avatar' => $avatarUrl ?: '',
            'avatar_thumb' => $avatarThumb,
            'system_prompt' => (string) ($request->input('system_prompt') ?? ''),
            'template_schema_version' => 1,
            'template_version' => 1,
            'role_profile' => $this->sanitizeRoleProfile($request->input('role_profile')),
            'workflow_templates' => $this->sanitizeTemplateList($request->input('workflow_templates')),
            'acceptance_templates' => $this->sanitizeTemplateList($request->input('acceptance_templates')),
            'recommended_skill_dirs' => $this->sanitizeStringList($request->input('recommended_skill_dirs'), 50, 120),
            'connector_requirements' => $this->sanitizeStringList($request->input('connector_requirements'), 50, 120),
            'tool_skill_ids' => $this->sanitizeToolSkillIds($request->input('tool_skill_ids')),
            'tool_approval' => $this->normalizeToolApproval($request->input('tool_approval')),
            'enable_image_gen' => $request->boolean('enable_image_gen'),
            'tags' => $this->sanitizeTags($request->input('tags')),
            'sort_order' => 0,
            'is_visible' => $skipAudit,
            'submission_status' => $status,
            'source_type' => Agent::SOURCE_USER,
            'submitted_by_user_id' => $user->id,
            'submitted_by_nickname' => $user->nickname ?: $user->username,
            'reviewed_by_user_id' => $skipAudit ? $user->id : null,
            'reviewed_at' => $skipAudit ? $now : null,
            'source_local_agent_id' => $localId,
            'submitted_at' => $now,
            'published_at' => $skipAudit ? $now : null,
            'created_by_user_id' => $user->id,
        ]);

        return response()->json([
            'ok' => true,
            'local_agent_id' => $localId,
            'cloud_agent_id' => (int) $agent->id,
            'submission_status' => $agent->submission_status,
        ], 201);
    }

    public function clientStatusBatch(Request $request): JsonResponse
    {
        $user = auth()->user();
        if (!$user) return response()->json(['error' => 'unauthenticated'], 401);

        $validator = Validator::make($request->all(), [
            'ids' => ['required', 'array', 'min:1', 'max:100'],
            'ids.*' => ['required', 'string', 'max:100'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $ids = array_values(array_unique(array_map('strval', $request->input('ids', []))));
        $rows = Agent::where('submitted_by_user_id', $user->id)
            ->whereIn('source_local_agent_id', $ids)
            ->orderByDesc('id')
            ->get();

        $seen = [];
        $items = [];
        foreach ($rows as $row) {
            $localId = (string) $row->source_local_agent_id;
            if ($localId === '' || isset($seen[$localId])) continue;
            $seen[$localId] = true;
            $items[] = [
                'local_agent_id' => $localId,
                'cloud_agent_id' => (int) $row->id,
                'submission_status' => (string) $row->submission_status,
                'reject_reason' => (string) $row->reject_reason,
                'reviewed_at' => optional($row->reviewed_at)->toIso8601String(),
                'published_at' => optional($row->published_at)->toIso8601String(),
            ];
        }

        return response()->json(['items' => $items]);
    }

    public function clientWithdraw(string $localId): JsonResponse
    {
        $user = auth()->user();
        if (!$user) return response()->json(['error' => 'unauthenticated'], 401);

        $agent = Agent::where('submitted_by_user_id', $user->id)
            ->where('source_local_agent_id', $localId)
            ->whereIn('submission_status', [Agent::STATUS_PENDING, Agent::STATUS_REJECTED])
            ->orderByDesc('id')
            ->first();
        if (!$agent) return response()->json(['error' => 'not_found'], 404);

        $agent->update([
            'submission_status' => Agent::STATUS_WITHDRAWN,
            'is_visible' => false,
        ]);
        return response()->json(['ok' => true, 'local_agent_id' => $localId]);
    }

    // ============== Client: 评分 ==============

    public function rate(Request $request, int $id): JsonResponse
    {
        $user = auth()->user();
        if (!$user) return response()->json(['error' => 'unauthenticated'], 401);

        $validator = Validator::make($request->all(), [
            'score' => ['required', 'integer', 'min:1', 'max:5'],
            'comment' => ['nullable', 'string', 'max:500'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $agent = Agent::find($id);
        if (!$agent) return response()->json(['error' => 'not_found'], 404);

        DB::transaction(function () use ($agent, $user, $request) {
            AgentRating::updateOrCreate(
                ['agent_id' => $agent->id, 'user_id' => $user->id],
                ['score' => (int) $request->input('score'), 'comment' => $request->input('comment')]
            );
            $this->recomputeRating($agent);
        });

        $agent->refresh();
        return response()->json([
            'ok' => true,
            'rating_avg' => (float) $agent->rating_avg,
            'rating_count' => (int) $agent->rating_count,
            'my_score' => (int) $request->input('score'),
        ]);
    }

    // ============== Client: 购买 / 获取 ==============

    /**
     * 桌面端「保存到本地」前调用：校验可见性 → 已购直接放行 → 免费记拥有 → 收费扣金币/积分。
     * 余额不足返回 402（格式与对话/视频等场景一致：error/needed/current/balance_type）。
     */
    public function acquire(Request $request, int $id): JsonResponse
    {
        $user = auth()->user();
        if (!$user) return response()->json(['error' => 'unauthenticated'], 401);

        $agent = Agent::where('id', $id)
            ->where('is_visible', true)
            ->where('submission_status', Agent::STATUS_APPROVED)
            ->first();
        if (!$agent) return response()->json(['error' => 'not_found'], 404);

        // 可见性校验：受限智能体仅白名单用户可获取
        if (!$this->isAgentVisibleTo($agent, $user)) {
            return response()->json(['error' => 'forbidden', 'message' => '无权获取该智能体'], 403);
        }

        // 已购买 → 幂等放行
        if (AgentPurchase::where('agent_id', $agent->id)->where('user_id', $user->id)->exists()) {
            return response()->json(['ok' => true, 'already_owned' => true, 'agent' => $this->acquiredShape($agent)]);
        }

        $price = $this->normalizePrice($agent->price);
        $type = $this->normalizeBalanceType($agent->price_balance_type);

        // 免费 → 记拥有（firstOrCreate 幂等，避免并发唯一键冲突 500）
        if ($price <= 0) {
            $purchase = AgentPurchase::firstOrCreate(
                ['agent_id' => $agent->id, 'user_id' => (int) $user->id],
                ['price' => 0, 'balance_type' => $type, 'purchased_at' => now()]
            );
            if ($purchase->wasRecentlyCreated) $agent->increment('download_count');
            return response()->json([
                'ok' => true,
                'price' => 0,
                'balance_type' => $type,
                'already_owned' => !$purchase->wasRecentlyCreated,
                'agent' => $this->acquiredShape($agent),
            ]);
        }

        // 收费 → 扣费 + 记拥有（同一事务，扣费成功才记录；失败回滚不扣钱）
        try {
            DB::transaction(function () use ($user, $agent, $type, $price) {
                app(BalanceService::class)->deduct(
                    $user,
                    $type,
                    $price,
                    'agent_purchase',
                    "购买智能体：{$agent->name}",
                    "agent:{$agent->id}"
                );
                $this->recordPurchase($agent, (int) $user->id, $price, $type);
                $agent->increment('download_count');
            });
        } catch (\Throwable $e) {
            // 并发下唯一键冲突：已购买，幂等返回
            if (AgentPurchase::where('agent_id', $agent->id)->where('user_id', $user->id)->exists()) {
                return response()->json(['ok' => true, 'already_owned' => true, 'agent' => $this->acquiredShape($agent)]);
            }
            if (str_contains($e->getMessage(), 'Insufficient')) {
                $current = app(BalanceService::class)->totalBalance((int) $user->id, $type);
                return response()->json([
                    'error' => $type === Agent::BALANCE_CREDIT ? 'Insufficient credit balance' : 'Insufficient token balance',
                    'needed' => $price,
                    'current' => $current,
                    'balance_type' => $type,
                ], 402);
            }
            return response()->json(['error' => 'acquire_failed', 'message' => $e->getMessage()], 500);
        }

        return response()->json(['ok' => true, 'price' => $price, 'balance_type' => $type, 'agent' => $this->acquiredShape($agent)]);
    }

    // ============== Helpers ==============

    private function agentValidator(Request $request, bool $creating)
    {
        return Validator::make($request->all(), [
            'category_id' => ['nullable', 'integer', 'exists:agent_categories,id'],
            'name' => [$creating ? 'required' : 'sometimes', 'string', 'max:100'],
            'description' => ['nullable', 'string', 'max:500'],
            'system_prompt' => ['nullable', 'string', 'max:20000'],
            'template_version' => ['nullable', 'integer', 'min:1', 'max:1000000'],
            'role_profile' => ['nullable'],
            'workflow_templates' => ['nullable'],
            'acceptance_templates' => ['nullable'],
            'recommended_skill_dirs' => ['nullable'],
            'connector_requirements' => ['nullable'],
            'tool_skill_ids' => ['nullable'],
            'tool_approval' => ['nullable', 'in:off,destructive,all'],
            'enable_image_gen' => ['nullable', 'boolean'],
            'kb_only' => ['nullable', 'boolean'],
            'kb_top_k' => ['nullable', 'integer', 'min:1', 'max:20'],
            'knowledge_base_ids' => ['nullable'],
            'tags' => ['nullable'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
            'is_visible' => ['nullable', 'boolean'],
            'price' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            'price_balance_type' => ['nullable', 'in:token,credit'],
            'visibility_scope' => ['nullable', 'in:public,restricted'],
            'visible_user_ids' => ['nullable'],
            'visible_group_ids' => ['nullable'],
            'avatar' => ['nullable', 'file', 'mimetypes:image/png,image/jpeg,image/webp', 'max:' . (int) (self::MAX_BYTES / 1024)],
            'avatar_thumb' => ['nullable', 'file', 'mimetypes:image/png,image/jpeg,image/webp', 'max:2048'],
            'avatar_url' => ['nullable', 'string', 'max:500'],
        ]);
    }

    private function validateAvatarAspect(UploadedFile $file): ?string
    {
        $info = @getimagesize($file->getRealPath());
        if (!$info || empty($info[0]) || empty($info[1])) {
            return '无法解析图片尺寸，请重新上传';
        }
        $w = (int) $info[0];
        $h = (int) $info[1];
        $ratio = $h / $w;
        if (abs($ratio - self::ASPECT_TARGET) > self::ASPECT_TOLERANCE) {
            return "形象图需为 2:3 竖图（当前 {$w}x{$h}）";
        }
        return null;
    }

    private function uploadFile(UploadedFile $file): ?string
    {
        $ext = strtolower($file->getClientOriginalExtension() ?: $file->extension() ?: 'png');
        if (!in_array($ext, ['png', 'jpg', 'jpeg', 'webp'], true)) $ext = 'png';
        return StorageService::upload($file, self::SUBDIR, (string) Str::uuid() . '.' . $ext);
    }

    private function sanitizeToolSkillIds($value): array
    {
        $arr = $this->parseJsonArray($value);
        $filtered = array_values(array_intersect(
            array_map('strval', $arr),
            Agent::BUILTIN_TOOL_SKILL_IDS
        ));
        return $filtered ?: Agent::BUILTIN_TOOL_SKILL_IDS;
    }

    private function sanitizeTags($value): array
    {
        $arr = $this->parseJsonArray($value);
        $tags = [];
        foreach ($arr as $item) {
            $t = trim((string) $item);
            if ($t !== '') $tags[] = mb_substr($t, 0, 20);
        }
        return array_values(array_slice(array_unique($tags), 0, 10));
    }

    private function normalizeToolApproval($value): string
    {
        $v = (string) ($value ?? '');
        return in_array($v, [Agent::TOOL_APPROVAL_OFF, Agent::TOOL_APPROVAL_DESTRUCTIVE, Agent::TOOL_APPROVAL_ALL], true)
            ? $v
            : Agent::TOOL_APPROVAL_DESTRUCTIVE;
    }

    private function parseJsonArray($value): array
    {
        if (is_array($value)) return $value;
        if (!is_string($value) || trim($value) === '') return [];
        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : [];
    }

    private function sanitizeStringList($value, int $maxItems, int $maxLength): array
    {
        $items = [];
        foreach ($this->parseJsonArray($value) as $item) {
            if (!is_scalar($item)) continue;
            $text = trim((string) $item);
            if ($text !== '') $items[] = mb_substr($text, 0, $maxLength);
        }
        return array_values(array_slice(array_unique($items), 0, $maxItems));
    }

    private function sanitizeRoleProfile($value): array
    {
        if (is_string($value)) $value = json_decode($value, true);
        if (!is_array($value)) return [];
        return [
            'role_summary' => mb_substr(trim((string) ($value['role_summary'] ?? '')), 0, 500),
            'responsibilities' => $this->sanitizeStringList($value['responsibilities'] ?? [], 50, 500),
            'boundaries' => $this->sanitizeStringList($value['boundaries'] ?? [], 50, 500),
            'standard_inputs' => $this->sanitizeStringList($value['standard_inputs'] ?? [], 50, 500),
            'deliverables' => $this->sanitizeStringList($value['deliverables'] ?? [], 50, 500),
        ];
    }

    private function sanitizeTemplateList($value): array
    {
        $result = [];
        foreach ($this->parseJsonArray($value) as $item) {
            if (!is_array($item)) continue;
            $title = mb_substr(trim((string) ($item['title'] ?? '')), 0, 200);
            $content = mb_substr(trim((string) ($item['content'] ?? '')), 0, 10000);
            if ($title !== '' && $content !== '') $result[] = ['title' => $title, 'content' => $content];
        }
        return array_slice($result, 0, 50);
    }

    private function normalizePrice($value): float
    {
        $p = (float) ($value ?? 0);
        return $p < 0 ? 0.0 : round($p, 2);
    }

    private function normalizeBalanceType($value): string
    {
        return in_array($value, [Agent::BALANCE_TOKEN, Agent::BALANCE_CREDIT], true)
            ? (string) $value
            : Agent::BALANCE_CREDIT;
    }

    private function sanitizeIdArray($value): array
    {
        $arr = $this->parseJsonArray($value);
        return array_values(array_unique(array_filter(array_map('intval', $arr), fn ($v) => $v > 0)));
    }

    private function normalizeKbTopK($value): int
    {
        $n = (int) ($value ?? 6);
        if ($n < 1) $n = 6;
        return min(20, max(1, $n));
    }

    /**
     * 同步智能体绑定的知识库（N:N）。仅当请求显式带 knowledge_base_ids 时才覆盖（update 时不传则保留原绑定）。
     */
    private function syncKnowledgeBases(Agent $agent, Request $request): void
    {
        if (!$request->has('knowledge_base_ids')) {
            return;
        }
        $ids = $this->sanitizeIdArray($request->input('knowledge_base_ids'));
        if (!empty($ids)) {
            // 过滤掉不存在的知识库 id，避免脏绑定
            $ids = \App\Models\KnowledgeBase::whereIn('id', $ids)->pluck('id')->map(fn ($i) => (int) $i)->all();
        }
        $syncData = [];
        foreach (array_values($ids) as $i => $kbId) {
            $syncData[$kbId] = ['sort_order' => $i];
        }
        $agent->knowledgeBases()->sync($syncData);
    }

    private function recordPurchase(Agent $agent, int $userId, float $price, string $type): void
    {
        AgentPurchase::create([
            'agent_id' => $agent->id,
            'user_id' => $userId,
            'price' => $price,
            'balance_type' => $type,
            'purchased_at' => now(),
        ]);
    }

    /**
     * 购买成功后下发给桌面端的完整数据（含收费智能体购买前在公开接口被隐藏的 system_prompt）。
     */
    private function acquiredShape(Agent $agent): array
    {
        // 绑定的云端知识库 id 列表（桌面端据此在线检索；权限随智能体授权传递）
        $kbIds = $agent->knowledgeBases()->pluck('knowledge_bases.id')->map(fn ($i) => (int) $i)->all();

        return [
            'id' => (int) $agent->id,
            'name' => (string) $agent->name,
            'description' => (string) $agent->description,
            'avatar' => $this->resolveStorageUrl((string) $agent->avatar),
            'system_prompt' => (string) $agent->system_prompt,
            'template_schema_version' => (int) ($agent->template_schema_version ?: 1),
            'template_version' => (int) ($agent->template_version ?: 1),
            'role_profile' => is_array($agent->role_profile) ? $agent->role_profile : [],
            'workflow_templates' => is_array($agent->workflow_templates) ? $agent->workflow_templates : [],
            'acceptance_templates' => is_array($agent->acceptance_templates) ? $agent->acceptance_templates : [],
            'recommended_skill_dirs' => is_array($agent->recommended_skill_dirs) ? $agent->recommended_skill_dirs : [],
            'connector_requirements' => is_array($agent->connector_requirements) ? $agent->connector_requirements : [],
            'tool_skill_ids' => is_array($agent->tool_skill_ids) ? $agent->tool_skill_ids : [],
            'tool_approval' => (string) $agent->tool_approval,
            'enable_image_gen' => (bool) $agent->enable_image_gen,
            'tags' => is_array($agent->tags) ? $agent->tags : [],
            // 云端知识库绑定（桌面端 acquire 后写入本地 bot.cloud_kb_ids）
            'cloud_kb_ids' => $kbIds,
            'cloud_kb_only' => (bool) $agent->kb_only ? 1 : 0,
            'cloud_kb_top_k' => (int) ($agent->kb_top_k ?: 6),
        ];
    }

    private function resolveStorageUrl(string $path): string
    {
        if ($path === '') return '';
        if (str_starts_with($path, 'http://') || str_starts_with($path, 'https://')) return $path;
        return rtrim((string) config('app.url'), '/') . '/' . ltrim($path, '/');
    }

    /**
     * 同步定向可见白名单：
     *  - 公开（public）：清空白名单
     *  - 受限（restricted）：仅当请求显式带 visible_user_ids / visible_group_ids 时先删后插
     */
    private function syncVisibilities(Agent $agent, Request $request): void
    {
        if ($agent->visibility_scope !== Agent::VISIBILITY_RESTRICTED) {
            AgentVisibility::where('agent_id', $agent->id)->delete();
            return;
        }
        if (!$request->has('visible_user_ids') && !$request->has('visible_group_ids')) {
            return;
        }

        $userIds = $this->sanitizeIdArray($request->input('visible_user_ids'));
        $groupIds = $this->sanitizeIdArray($request->input('visible_group_ids'));

        DB::transaction(function () use ($agent, $userIds, $groupIds) {
            AgentVisibility::where('agent_id', $agent->id)->delete();
            $now = now();
            $rows = [];
            foreach ($userIds as $uid) {
                $rows[] = ['agent_id' => $agent->id, 'assignee_type' => AgentVisibility::ASSIGNEE_USER, 'assignee_id' => $uid, 'created_at' => $now, 'updated_at' => $now];
            }
            foreach ($groupIds as $gid) {
                $rows[] = ['agent_id' => $agent->id, 'assignee_type' => AgentVisibility::ASSIGNEE_GROUP, 'assignee_id' => $gid, 'created_at' => $now, 'updated_at' => $now];
            }
            if ($rows) AgentVisibility::insert($rows);
        });
    }

    /**
     * 单个智能体是否对用户可见（acquire 复用）。public 恒可见；restricted 命中白名单（user / 所属 group）才可见。
     */
    private function isAgentVisibleTo(Agent $agent, $user): bool
    {
        if ($agent->visibility_scope !== Agent::VISIBILITY_RESTRICTED) {
            return true;
        }
        if (!$user) {
            return false;
        }
        $groupIds = $user->groups()->pluck('user_groups.id')->all();
        return AgentVisibility::where('agent_id', $agent->id)
            ->where(function ($w) use ($user, $groupIds) {
                $w->where(function ($x) use ($user) {
                    $x->where('assignee_type', AgentVisibility::ASSIGNEE_USER)
                        ->where('assignee_id', $user->id);
                });
                if (!empty($groupIds)) {
                    $w->orWhere(function ($x) use ($groupIds) {
                        $x->where('assignee_type', AgentVisibility::ASSIGNEE_GROUP)
                            ->whereIn('assignee_id', $groupIds);
                    });
                }
            })
            ->exists();
    }

    private function recomputeRating(Agent $agent): void
    {
        $agg = AgentRating::where('agent_id', $agent->id)
            ->selectRaw('COUNT(*) as cnt, COALESCE(AVG(score), 0) as avg_score')
            ->first();
        $agent->update([
            'rating_count' => (int) ($agg->cnt ?? 0),
            'rating_avg' => round((float) ($agg->avg_score ?? 0), 2),
        ]);
    }

    private function deleteAgentStorageFile(string $url): void
    {
        $path = $url;
        if (str_starts_with($url, 'http://') || str_starts_with($url, 'https://')) {
            $path = (string) (parse_url($url, PHP_URL_PATH) ?: '');
        }
        if (str_starts_with(ltrim($path, '/'), self::SUBDIR . '/')) {
            StorageService::delete($url);
        }
    }
}
