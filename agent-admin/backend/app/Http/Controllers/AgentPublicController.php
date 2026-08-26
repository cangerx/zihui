<?php

namespace App\Http\Controllers;

use App\Models\Agent;
use App\Models\AgentCategory;
use App\Models\AgentPurchase;
use App\Models\AgentVisibility;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AgentPublicController extends Controller
{
    /**
     * 桌面端「智能体市场」可见分类（免登录）。
     */
    public function categories(): JsonResponse
    {
        $categories = AgentCategory::query()
            ->where('is_visible', true)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get(['id', 'name', 'description', 'sort_order']);

        return response()->json(['data' => $categories]);
    }

    /**
     * 桌面端「智能体市场」列表（可选登录，套 auth.jwt.optional）。
     * 只返回审核通过 + 上架的智能体；按可见范围过滤：
     *  - public：全员可见
     *  - restricted：仅命中 agent_visibilities 白名单（user / 所属 group）的登录用户可见
     */
    public function list(Request $request): JsonResponse
    {
        $user = auth()->user();

        $query = Agent::with(['category', 'knowledgeBases:id'])
            ->where('is_visible', true)
            ->where('submission_status', Agent::STATUS_APPROVED)
            ->orderBy('sort_order')
            ->orderByDesc('id');

        $this->applyVisibilityScope($query, $user);

        if ($request->filled('category_id')) {
            $query->where('category_id', $request->input('category_id'));
        }
        if ($request->filled('search')) {
            $s = (string) $request->input('search');
            $query->where(function ($q) use ($s) {
                $q->where('name', 'like', "%{$s}%")
                    ->orWhere('description', 'like', "%{$s}%");
            });
        }

        $perPage = min((int) $request->input('per_page', 40), 100);
        $page = (int) $request->input('page', 1);
        $paginated = $query->paginate($perPage, ['*'], 'page', $page);

        $ownedIds = $this->ownedAgentIds($user, collect($paginated->items())->pluck('id')->all());
        $items = collect($paginated->items())->map(fn ($agent) => $this->publicShape($agent, $ownedIds))->all();

        return response()->json([
            'items' => $items,
            'total' => $paginated->total(),
        ]);
    }

    public function show(int $id): JsonResponse
    {
        $user = auth()->user();
        $agent = Agent::with('knowledgeBases:id')
            ->where('id', $id)
            ->where('is_visible', true)
            ->where('submission_status', Agent::STATUS_APPROVED)
            ->first();
        // 不可见时同样返回 404，避免暴露受限智能体的存在
        if (!$agent || !$this->isAgentVisibleTo($agent, $user)) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $ownedIds = $this->ownedAgentIds($user, [(int) $agent->id]);
        return response()->json($this->publicShape($agent, $ownedIds));
    }

    /**
     * 桌面端「保存到本地」时回调，下载量 +1（老客户端兼容；免费智能体路径）。
     * 收费 / 受限智能体应走 POST /client/agents/{id}/acquire（带鉴权 + 扣费）。
     * 公开端点（throttle 在路由层兜底防刷）。
     */
    public function incrementDownload(int $id): JsonResponse
    {
        $agent = Agent::where('id', $id)
            ->where('is_visible', true)
            ->where('submission_status', Agent::STATUS_APPROVED)
            ->first();
        if (!$agent) return response()->json(['error' => 'not_found'], 404);

        $agent->increment('download_count');
        return response()->json(['ok' => true, 'download_count' => (int) $agent->download_count + 0]);
    }

    /**
     * 可见范围过滤（应用于查询）：public 全员可见；restricted 仅命中白名单的登录用户可见。
     */
    private function applyVisibilityScope($query, $user): void
    {
        $query->where(function ($q) use ($user) {
            $q->where('visibility_scope', Agent::VISIBILITY_PUBLIC);
            if ($user) {
                $groupIds = $user->groups()->pluck('user_groups.id')->all();
                $q->orWhere(function ($qq) use ($user, $groupIds) {
                    $qq->where('visibility_scope', Agent::VISIBILITY_RESTRICTED)
                        ->whereExists(function ($sub) use ($user, $groupIds) {
                            $sub->selectRaw('1')
                                ->from('agent_visibilities')
                                ->whereColumn('agent_visibilities.agent_id', 'agents.id')
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
                                });
                        });
                });
            }
        });
    }

    /**
     * 单个智能体是否对当前用户可见（show / acquire 复用同一判定）。
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

    /**
     * 当前用户已购买的智能体 id 集合（一次查询，避免 N+1）。
     */
    private function ownedAgentIds($user, array $agentIds): array
    {
        if (!$user || empty($agentIds)) {
            return [];
        }
        return AgentPurchase::where('user_id', $user->id)
            ->whereIn('agent_id', $agentIds)
            ->pluck('agent_id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    /**
     * 公开输出形态：补全头像绝对 URL，裁掉内部字段，附带定价与是否已拥有。
     */
    private function publicShape(Agent $agent, array $ownedIds = []): array
    {
        $owned = in_array((int) $agent->id, $ownedIds, true);
        // 收费且未购买：隐藏 system_prompt（核心付费内容）；购买后由 /client/agents/{id}/acquire 下发完整数据
        $canSeeSecret = $owned || (float) $agent->price <= 0;
        // kb 绑定遵循同一隐藏策略（未拥有且收费则不暴露绑定关系）
        $kbIds = $canSeeSecret
            ? ($agent->relationLoaded('knowledgeBases')
                ? $agent->knowledgeBases->pluck('id')->map(fn ($i) => (int) $i)->all()
                : $agent->knowledgeBases()->pluck('knowledge_bases.id')->map(fn ($i) => (int) $i)->all())
            : [];
        return [
            'id' => (int) $agent->id,
            'category_id' => $agent->category_id !== null ? (int) $agent->category_id : null,
            'category_name' => $agent->category?->name,
            'name' => (string) $agent->name,
            'description' => (string) $agent->description,
            'avatar' => $this->resolveUrl((string) $agent->avatar),
            'avatar_thumb' => $this->resolveUrl((string) $agent->avatar_thumb),
            'system_prompt' => $canSeeSecret ? (string) $agent->system_prompt : '',
            'template_schema_version' => (int) ($agent->template_schema_version ?: 1),
            'template_version' => (int) ($agent->template_version ?: 1),
            'role_profile' => $canSeeSecret && is_array($agent->role_profile) ? $agent->role_profile : [],
            'workflow_templates' => $canSeeSecret && is_array($agent->workflow_templates) ? $agent->workflow_templates : [],
            'acceptance_templates' => $canSeeSecret && is_array($agent->acceptance_templates) ? $agent->acceptance_templates : [],
            'recommended_skill_dirs' => $canSeeSecret && is_array($agent->recommended_skill_dirs) ? $agent->recommended_skill_dirs : [],
            'connector_requirements' => $canSeeSecret && is_array($agent->connector_requirements) ? $agent->connector_requirements : [],
            'tool_skill_ids' => is_array($agent->tool_skill_ids) ? $agent->tool_skill_ids : [],
            'tool_approval' => (string) $agent->tool_approval,
            'enable_image_gen' => (bool) $agent->enable_image_gen,
            'tags' => is_array($agent->tags) ? $agent->tags : [],
            'cloud_kb_ids' => $kbIds,
            'cloud_kb_only' => (bool) $agent->kb_only ? 1 : 0,
            'cloud_kb_top_k' => (int) ($agent->kb_top_k ?: 6),
            'download_count' => (int) $agent->download_count,
            'rating_avg' => (float) $agent->rating_avg,
            'rating_count' => (int) $agent->rating_count,
            'sort_order' => (int) $agent->sort_order,
            'author_nickname' => (string) $agent->submitted_by_nickname,
            // 定价：price=0 免费；>0 需购买。price_balance_type：token=金币 / credit=积分
            'price' => (float) $agent->price,
            'price_balance_type' => (string) ($agent->price_balance_type ?: Agent::BALANCE_CREDIT),
            'is_owned' => $owned,
            'created_at' => optional($agent->created_at)->toIso8601String(),
        ];
    }

    private function resolveUrl(string $path): string
    {
        if ($path === '') return '';
        if (str_starts_with($path, 'http://') || str_starts_with($path, 'https://')) {
            return $path;
        }
        return rtrim((string) config('app.url'), '/') . '/' . ltrim($path, '/');
    }
}
