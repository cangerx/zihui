<?php

namespace App\Http\Controllers;

use App\Models\Plan;
use App\Models\PlanCategory;
use App\Models\PlanModelAssignment;
use App\Models\PlanPermission;
use App\Models\User;
use App\Models\UserGroup;
use App\Models\UserPlan;
use App\Models\UserPlanQuota;
use App\Services\OemChannelService;
use App\Services\PlanService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

class PlanController extends Controller
{
    // ===== Admin: plan categories =====
    public function categoryIndex()
    {
        $categories = PlanCategory::withCount('plans')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();

        return response()->json(['data' => $categories]);
    }

    public function categoryStore(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:100',
            'sort_order' => 'nullable|integer|min:0',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $category = PlanCategory::create([
            'name' => $request->input('name'),
            'sort_order' => (int)$request->input('sort_order', 0),
        ]);

        return response()->json($category, 201);
    }

    public function categoryUpdate(Request $request, $id)
    {
        $category = PlanCategory::findOrFail($id);
        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:100',
            'sort_order' => 'nullable|integer|min:0',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $category->update([
            'name' => $request->input('name'),
            'sort_order' => (int)$request->input('sort_order', $category->sort_order),
        ]);

        return response()->json($category);
    }

    public function categoryDestroy($id)
    {
        $category = PlanCategory::findOrFail($id);
        $category->delete();

        return response()->json(['message' => 'deleted']);
    }

    // ===== Admin: plans CRUD =====
    public function index(Request $request)
    {
        $query = Plan::with('category:id,name,sort_order');

        if ($request->filled('status')) $query->where('status', $request->status);
        if ($request->filled('category_id')) $query->where('category_id', $request->category_id);
        if ($request->filled('keyword')) {
            $kw = $request->keyword;
            $query->where(function ($q) use ($kw) {
                $q->where('code', 'like', "%{$kw}%")
                  ->orWhere('name', 'like', "%{$kw}%");
            });
        }

        $data = $query->orderBy('sort')->orderByDesc('id')->paginate($request->get('per_page', 50));
        $items = collect($data->items());
        app(OemChannelService::class)->enrichPlanVisibilities($items);
        return response()->json([
            'data' => $items,
            'total' => $data->total(),
            'current_page' => $data->currentPage(),
            'per_page' => $data->perPage(),
        ]);
    }

    public function show($id)
    {
        $plan = Plan::with(['category:id,name,sort_order', 'modelAssignments.cloudModel:id,model_id,name,type', 'permissions'])->findOrFail($id);
        app(OemChannelService::class)->enrichPlanVisibilities(collect([$plan]));
        return response()->json($plan);
    }

    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'category_id'   => 'nullable|integer|exists:plan_categories,id',
            'name'          => 'required|string|max:100',
            'description'   => 'nullable|string|max:200',
            'price'         => 'nullable|numeric|min:0',
            'currency'      => 'nullable|string|max:10',
            'duration_days' => 'required|integer|min:0',
            'token_quota'   => 'nullable|numeric|min:0',
            'credit_quota'  => 'nullable|numeric|min:0',
            'storage_quota_bytes' => 'nullable|integer|min:0',
            'quota_refill_cycle' => 'nullable|in:none,monthly',
            'sort'          => 'nullable|integer',
            'remark'        => 'nullable|string|max:500',
            'model_ids'     => 'nullable|array',
            'model_ids.*'   => 'integer|exists:cloud_models,id',
            'policies'      => 'nullable|array',
            'rate_limit'    => 'nullable|array',
            'rate_limit_json' => 'nullable|array',
            'channel_keys'  => 'nullable|array',
            'channel_keys.*' => 'string|max:64',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        return DB::transaction(function () use ($request) {
            $plan = Plan::create([
                'category_id'   => $request->input('category_id') ?: null,
                'code'          => $this->nextPlanCode(),
                'name'          => $request->name,
                'description'   => (string)$request->input('description', ''),
                'price'         => (float)$request->input('price', 0),
                'currency'      => (string)$request->input('currency', 'CNY'),
                'duration_days' => (int)$request->duration_days,
                'token_quota'   => (float)$request->input('token_quota', 0),
                'credit_quota'  => (float)$request->input('credit_quota', 0),
                'storage_quota_bytes' => (int)$request->input('storage_quota_bytes', 0),
                'quota_refill_cycle' => $request->input('quota_refill_cycle', 'none'),
                'status'        => 'active',
                'sort'          => (int)$request->input('sort', 0),
                'remark'        => (string)$request->input('remark', ''),
                'rate_limit_json' => $this->normalizeRateLimit($request),
            ]);

            $this->syncRelations($plan, $request->input('model_ids', []), $request->input('policies', []));
            app(OemChannelService::class)->syncPlanVisibilities($plan->id, $request->input('channel_keys', ['default']));

            return response()->json($plan->load(['modelAssignments', 'permissions']), 201);
        });
    }

    public function update(Request $request, $id)
    {
        $plan = Plan::findOrFail($id);

        $validator = Validator::make($request->all(), [
            'name'          => 'nullable|string|max:100',
            'category_id'   => 'nullable|integer|exists:plan_categories,id',
            'description'   => 'nullable|string|max:200',
            'price'         => 'nullable|numeric|min:0',
            'currency'      => 'nullable|string|max:10',
            'duration_days' => 'nullable|integer|min:0',
            'token_quota'   => 'nullable|numeric|min:0',
            'credit_quota'  => 'nullable|numeric|min:0',
            'storage_quota_bytes' => 'nullable|integer|min:0',
            'quota_refill_cycle' => 'nullable|in:none,monthly',
            'status'        => 'nullable|in:active,archived',
            'sort'          => 'nullable|integer',
            'remark'        => 'nullable|string|max:500',
            'model_ids'     => 'nullable|array',
            'model_ids.*'   => 'integer|exists:cloud_models,id',
            'policies'      => 'nullable|array',
            'rate_limit'    => 'nullable|array',
            'rate_limit_json' => 'nullable|array',
            'channel_keys'  => 'nullable|array',
            'channel_keys.*' => 'string|max:64',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        return DB::transaction(function () use ($request, $plan) {
            foreach (['name', 'category_id', 'description', 'price', 'currency', 'duration_days', 'token_quota', 'credit_quota', 'storage_quota_bytes', 'quota_refill_cycle', 'status', 'sort', 'remark'] as $f) {
                if ($request->has($f)) $plan->$f = $this->normalizePlanField($f, $request->input($f));
            }
            if ($request->has('rate_limit') || $request->has('rate_limit_json')) {
                $plan->rate_limit_json = $this->normalizeRateLimit($request);
            }
            $plan->save();

            if ($request->has('model_ids') || $request->has('policies')) {
                $this->syncRelations($plan, $request->input('model_ids'), $request->input('policies'));
            }
            if ($request->has('channel_keys')) {
                app(OemChannelService::class)->syncPlanVisibilities($plan->id, $request->input('channel_keys', []));
            }

            return response()->json($plan->load(['modelAssignments', 'permissions']));
        });
    }

    public function destroy($id)
    {
        $plan = Plan::findOrFail($id);

        // If any UserPlan references this plan, archive instead of delete.
        $inUse = UserPlan::where('plan_id', $id)->exists();
        if ($inUse) {
            $plan->status = 'archived';
            $plan->save();
            return response()->json(['archived' => true, 'message' => '该套餐已被用户持有，已自动归档']);
        }

        $plan->delete();
        return response()->json(['message' => 'deleted']);
    }

    /**
     * 批量删除：循环调用 destroy，区分 deleted / archived。
     * 「被用户持有」的套餐会自动归档而非物理删，统计上单独计数。
     */
    public function batchDestroy(Request $request)
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', (array) $request->input('ids', [])))));
        if (empty($ids)) return response()->json(['error' => 'ids 不能为空'], 400);
        if (count($ids) > 200) return response()->json(['error' => '单次批量操作不超过 200 条'], 400);

        $deleted = 0; $archived = 0; $errors = [];
        foreach ($ids as $id) {
            try {
                $resp = $this->destroy($id);
                $data = $resp->getData(true);
                if ($resp->getStatusCode() >= 400) {
                    $errors[] = ['id' => $id, 'error' => $data['error'] ?? ('HTTP ' . $resp->getStatusCode())];
                    continue;
                }
                if (!empty($data['archived'])) $archived++;
                else $deleted++;
            } catch (\Throwable $e) {
                $errors[] = ['id' => $id, 'error' => $e->getMessage()];
            }
        }

        return response()->json([
            'deleted'  => $deleted,
            'archived' => $archived,
            'errors'   => $errors,
            'total'    => count($ids),
        ]);
    }

    // ===== Admin: grant plan to user =====
    public function grant(Request $request, $userId)
    {
        $validator = Validator::make($request->all(), [
            'plan_id' => 'required|integer|exists:plans,id',
            'remark'  => 'nullable|string|max:500',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $user = User::findOrFail($userId);
        $plan = Plan::findOrFail($request->plan_id);

        if ($plan->status !== 'active') {
            return response()->json(['error' => '套餐已归档'], 400);
        }

        $service = app(PlanService::class);
        $userPlan = $service->grant($user, $plan, [
            'source'   => 'admin',
            'operator' => auth()->id(),
            'remark'   => (string)$request->input('remark', ''),
        ]);

        if (!$userPlan) {
            return response()->json(['error' => '套餐发放失败'], 400);
        }

        return response()->json(['user_plan' => $userPlan->load('plan:id,code,name')], 201);
    }

    // ===== Admin: revoke user plan =====
    public function revoke($userPlanId)
    {
        $userPlan = UserPlan::findOrFail($userPlanId);
        if ($userPlan->status !== 'active') {
            return response()->json(['error' => '该用户套餐非活跃状态'], 400);
        }

        $service = app(PlanService::class);
        $service->revoke($userPlan);
        return response()->json(['message' => '已撤销']);
    }

    /**
     * \u6279\u91cf\u53d1\u653e\u5957\u9910\uff1auser_ids[] + group_ids[] \u5408\u5e76\u53bb\u91cd\u540e\u9010\u4e2a grant\u3002
     */
    public function batchGrant(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'plan_id'     => 'required|integer|exists:plans,id',
            'user_ids'    => 'nullable|array',
            'user_ids.*'  => 'integer|exists:users,id',
            'group_ids'   => 'nullable|array',
            'group_ids.*' => 'integer|exists:user_groups,id',
            'remark'      => 'nullable|string|max:500',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $userIds  = $request->input('user_ids', []) ?? [];
        $groupIds = $request->input('group_ids', []) ?? [];
        if (empty($userIds) && empty($groupIds)) {
            return response()->json(['error' => '\u8bf7\u81f3\u5c11\u63d0\u4f9b\u4e00\u4e2a\u7528\u6237\u6216\u5206\u7ec4'], 422);
        }

        $plan = Plan::findOrFail($request->plan_id);
        if ($plan->status !== 'active') {
            return response()->json(['error' => '\u5957\u9910\u5df2\u5f52\u6863'], 400);
        }

        // \u5c55\u5f00\u5206\u7ec4\u4e3a\u7528\u6237
        if (!empty($groupIds)) {
            $groupUserIds = DB::table('user_group_members')
                ->whereIn('group_id', $groupIds)
                ->pluck('user_id')
                ->toArray();
            $userIds = array_merge($userIds, $groupUserIds);
        }
        $userIds = array_values(array_unique(array_map('intval', $userIds)));

        if (empty($userIds)) {
            return response()->json(['error' => '\u6240\u9009\u5206\u7ec4\u65e0\u6210\u5458'], 422);
        }

        $service = app(PlanService::class);
        $operator = auth()->id();
        $remark   = (string)$request->input('remark', '');

        $success = 0;
        $failed  = [];

        foreach ($userIds as $uid) {
            try {
                $user = User::find($uid);
                if (!$user) {
                    $failed[] = ['user_id' => $uid, 'reason' => 'user not found'];
                    continue;
                }
                $up = $service->grant($user, $plan, [
                    'source'   => 'admin',
                    'operator' => $operator,
                    'remark'   => $remark,
                ]);
                if ($up) {
                    $success++;
                } else {
                    $failed[] = ['user_id' => $uid, 'reason' => 'grant returned null'];
                }
            } catch (\Throwable $e) {
                $failed[] = ['user_id' => $uid, 'reason' => $e->getMessage()];
            }
        }

        return response()->json([
            'total'      => count($userIds),
            'success'    => $success,
            'failed'     => $failed,
        ]);
    }

    /**
     * \u6279\u91cf\u64a4\u9500 UserPlan\uff1auser_plan_ids[]\u3002
     */
    public function batchRevoke(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'user_plan_ids'   => 'required|array|min:1',
            'user_plan_ids.*' => 'integer|exists:user_plans,id',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $ids = array_values(array_unique($request->user_plan_ids));
        $service = app(PlanService::class);

        $success = 0;
        $skipped = 0;
        $failed  = [];

        foreach ($ids as $id) {
            try {
                $up = UserPlan::find($id);
                if (!$up) {
                    $failed[] = ['id' => $id, 'reason' => 'not found'];
                    continue;
                }
                if ($up->status !== 'active') {
                    $skipped++;
                    continue;
                }
                $service->revoke($up);
                $success++;
            } catch (\Throwable $e) {
                $failed[] = ['id' => $id, 'reason' => $e->getMessage()];
            }
        }

        return response()->json([
            'total'   => count($ids),
            'success' => $success,
            'skipped' => $skipped,
            'failed'  => $failed,
        ]);
    }

    // ===== Admin: list user plans =====
    public function userPlans(Request $request)
    {
        $query = UserPlan::with([
            'plan:id,code,name',
            'user:id,username,nickname',
            'quotas',
        ]);

        if ($request->filled('user_id')) $query->where('user_id', $request->user_id);
        if ($request->filled('plan_id')) $query->where('plan_id', $request->plan_id);
        if ($request->filled('status'))  $query->where('status', $request->status);

        $data = $query->orderByDesc('id')->paginate($request->get('per_page', 50));
        $now = now();
        $items = collect($data->items())->map(function ($userPlan) use ($now) {
            $quotas = $userPlan->quotas;
            $summary = [];
            foreach (['token', 'credit'] as $type) {
                $items = $quotas->where('balance_type', $type)
                    ->filter(fn($quota) => $quota->status === 'active' && (!$quota->expires_at || $quota->expires_at->gt($now)));
                $summary[$type] = [
                    'granted' => (float)$items->sum(fn($quota) => (float)$quota->granted),
                    'consumed' => (float)$items->sum(fn($quota) => (float)$quota->consumed),
                    'remaining' => (float)$items->sum(fn($quota) => max(0, (float)$quota->granted - (float)$quota->consumed)),
                ];
            }
            $arr = $userPlan->toArray();
            $arr['quota_summary'] = $summary;
            $arr['quota_bucket_count'] = $quotas->count();
            unset($arr['quotas']);
            return $arr;
        });
        return response()->json([
            'data' => $items,
            'total' => $data->total(),
            'current_page' => $data->currentPage(),
            'per_page' => $data->perPage(),
        ]);
    }

    public function userPlanQuotas(Request $request)
    {
        $query = UserPlanQuota::with([
            'user:id,username,nickname',
            'plan:id,code,name',
            'userPlan:id,user_id,plan_id,status,activated_at,expires_at,source',
        ]);

        if ($request->filled('user_id')) $query->where('user_id', $request->user_id);
        if ($request->filled('plan_id')) $query->where('plan_id', $request->plan_id);
        if ($request->filled('user_plan_id')) $query->where('user_plan_id', $request->user_plan_id);
        if ($request->filled('balance_type')) $query->where('balance_type', $request->balance_type);
        if ($request->filled('status')) $query->where('status', $request->status);
        if ($request->filled('expires_before')) {
            $query->whereNotNull('expires_at')->where('expires_at', '<=', $request->expires_before . ' 23:59:59');
        }

        $summaryRows = (clone $query)
            ->select(
                'balance_type',
                DB::raw('SUM(granted) as granted'),
                DB::raw('SUM(consumed) as consumed'),
                DB::raw('SUM(GREATEST(granted - consumed, 0)) as remaining')
            )
            ->groupBy('balance_type')
            ->get();

        $availableSummaryRows = (clone $query)
            ->where('status', 'active')
            ->where(function ($q) {
                $q->whereNull('expires_at')->orWhere('expires_at', '>', now());
            })
            ->select(
                'balance_type',
                DB::raw('SUM(granted) as granted'),
                DB::raw('SUM(consumed) as consumed'),
                DB::raw('SUM(GREATEST(granted - consumed, 0)) as remaining')
            )
            ->groupBy('balance_type')
            ->get();

        $data = $query->orderByRaw('expires_at IS NULL ASC')
            ->orderBy('expires_at')
            ->orderByDesc('id')
            ->paginate($request->get('per_page', 50));

        $summary = [
            'token' => ['granted' => 0.0, 'consumed' => 0.0, 'remaining' => 0.0],
            'credit' => ['granted' => 0.0, 'consumed' => 0.0, 'remaining' => 0.0],
        ];
        foreach ($summaryRows as $row) {
            $type = (string)$row->balance_type;
            if (!isset($summary[$type])) continue;
            $summary[$type] = [
                'granted' => (float)$row->granted,
                'consumed' => (float)$row->consumed,
                'remaining' => (float)$row->remaining,
            ];
        }
        $availableSummary = [
            'token' => ['granted' => 0.0, 'consumed' => 0.0, 'remaining' => 0.0],
            'credit' => ['granted' => 0.0, 'consumed' => 0.0, 'remaining' => 0.0],
        ];
        foreach ($availableSummaryRows as $row) {
            $type = (string)$row->balance_type;
            if (!isset($availableSummary[$type])) continue;
            $availableSummary[$type] = [
                'granted' => (float)$row->granted,
                'consumed' => (float)$row->consumed,
                'remaining' => (float)$row->remaining,
            ];
        }

        return response()->json([
            'data' => $data->items(),
            'total' => $data->total(),
            'current_page' => $data->currentPage(),
            'per_page' => $data->perPage(),
            'summary' => $summary,
            'available_summary' => $availableSummary,
        ]);
    }

    // ===== Client: store list =====
    /**
     * 商城列表：返回所有 active 套餐供软件端选购页面使用。
     * 与 myPlans 不同：返回的是套餐主数据（而非用户已持有套餐）。
     */
    public function clientList(Request $request)
    {
        $oemProjectKey = app(OemChannelService::class)->channelKeyFromRequest($request);
        $query = Plan::with(['category:id,name,sort_order', 'modelAssignments.cloudModel:id,model_id,name,type', 'permissions'])
            ->where('status', 'active');
        app(OemChannelService::class)->applyPlanVisibility($query, $oemProjectKey);
        $plans = $query->orderBy('sort')
            ->orderByDesc('id')
            ->get()
            ->map(function ($plan) {
                return [
                    'id'            => (int)$plan->id,
                    'category_id'   => $plan->category_id ? (int)$plan->category_id : null,
                    'category'      => $plan->category ? [
                        'id'         => (int)$plan->category->id,
                        'name'       => (string)$plan->category->name,
                        'sort_order' => (int)$plan->category->sort_order,
                    ] : null,
                    'code'          => (string)$plan->code,
                    'name'          => (string)$plan->name,
                    'description'   => (string)$plan->description,
                    'price'         => (string)$plan->price,
                    'currency'      => (string)$plan->currency,
                    'duration_days' => (int)$plan->duration_days,
                    'token_quota'   => (float)$plan->token_quota,
                    'credit_quota'  => (float)$plan->credit_quota,
                    'storage_quota_bytes' => (int)($plan->storage_quota_bytes ?? 0),
                    'quota_refill_cycle' => (string)($plan->quota_refill_cycle ?? 'none'),
                    'policies'      => $this->policyMap($plan->permissions),
                    'rate_limit'    => is_array($plan->rate_limit_json) ? $plan->rate_limit_json : [],
                    'sort'          => (int)$plan->sort,
                    'models'        => $plan->modelAssignments->map(fn($pma) => [
                        'id'       => (int)$pma->cloud_model_id,
                        'model_id' => $pma->cloudModel->model_id ?? '',
                        'name'     => $pma->cloudModel->name ?? '',
                        'type'     => $pma->cloudModel->type ?? '',
                    ])->values(),
                ];
            });
        return response()->json(['plans' => $plans]);
    }

    // ===== Client: my plans =====
    public function myPlans()
    {
        $user = auth()->user();

        $plans = UserPlan::with([
            'plan:id,code,name,description,duration_days,token_quota,credit_quota,storage_quota_bytes,quota_refill_cycle,rate_limit_json',
            'plan.modelAssignments.cloudModel:id,model_id,name,type',
            'plan.permissions',
            'quotas',
        ])
            ->where('user_id', $user->id)
            ->orderByDesc('id')
            ->get()
            ->map(function ($up) {
                $snapshot = is_array($up->policy_snapshot_json) ? $up->policy_snapshot_json : [];
                $policies = is_array($snapshot['policies'] ?? null)
                    ? $snapshot['policies']
                    : ($up->plan ? $this->policyMap($up->plan->permissions) : []);
                $rateLimit = is_array($snapshot['rate_limit'] ?? null)
                    ? $snapshot['rate_limit']
                    : (($up->plan && is_array($up->plan->rate_limit_json)) ? $up->plan->rate_limit_json : []);
                $quotaBuckets = $up->quotas->map(fn($quota) => [
                    'id' => (int)$quota->id,
                    'balance_type' => $quota->balance_type,
                    'granted' => (float)$quota->granted,
                    'consumed' => (float)$quota->consumed,
                    'remaining' => max(0, (float)$quota->granted - (float)$quota->consumed),
                    'expires_at' => $quota->expires_at,
                    'status' => $quota->status,
                ])->values();
                $quotaSummary = [];
                foreach (['token', 'credit'] as $type) {
                    $typeQuotas = $up->quotas->where('balance_type', $type);
                    $quotaSummary[$type] = [
                        'granted' => (float)$typeQuotas->sum(fn($quota) => (float)$quota->granted),
                        'consumed' => (float)$typeQuotas->sum(fn($quota) => (float)$quota->consumed),
                        'remaining' => (float)$typeQuotas->sum(fn($quota) => max(0, (float)$quota->granted - (float)$quota->consumed)),
                    ];
                }
                return [
                    'id'             => $up->id,
                    'plan_id'        => $up->plan_id,
                    'plan_code'      => $up->plan->code ?? null,
                    'plan_name'      => $up->plan->name ?? null,
                    'description'    => $up->plan->description ?? '',
                    'source'         => $up->source,
                    'activated_at'   => $up->activated_at,
                    'expires_at'     => $up->expires_at,
                    'quota_refill_cycle' => (string)($up->quota_refill_cycle ?? 'none'),
                    'last_quota_refilled_at' => $up->last_quota_refilled_at,
                    'next_quota_refill_at' => $up->next_quota_refill_at,
                    'upgraded_from_user_plan_id' => $up->upgraded_from_user_plan_id ? (int)$up->upgraded_from_user_plan_id : null,
                    'status'         => $up->status,
                    'token_granted'  => (float)$up->token_granted,
                    'credit_granted' => (float)$up->credit_granted,
                    'policies'       => $policies,
                    'rate_limit'     => $rateLimit,
                    'quota_buckets'  => $quotaBuckets,
                    'quota_summary'  => $quotaSummary,
                    'models'         => $up->plan ? $up->plan->modelAssignments->map(fn($pma) => [
                        'id'       => $pma->cloud_model_id,
                        'model_id' => $pma->cloudModel->model_id ?? '',
                        'name'     => $pma->cloudModel->name ?? '',
                        'type'     => $pma->cloudModel->type ?? '',
                    ])->values() : [],
                ];
            });

        return response()->json(['plans' => $plans]);
    }

    // ===== Helpers =====

    /**
     * Sync plan_model_assignments and plan_permissions.
     * Only operates if the field is present in request (null = no change).
     */
    private function syncRelations(Plan $plan, $modelIds, $policies): void
    {
        if (is_array($modelIds)) {
            // Replace all current assignments
            PlanModelAssignment::where('plan_id', $plan->id)->delete();
            foreach (array_unique($modelIds) as $mid) {
                PlanModelAssignment::create([
                    'plan_id' => $plan->id,
                    'cloud_model_id' => (int)$mid,
                ]);
            }
        }

        if (is_array($policies)) {
            PlanPermission::where('plan_id', $plan->id)->delete();
            foreach ($policies as $key => $value) {
                if (!is_string($key) || $key === '') continue;
                // 统一 json_encode 保证类型语义（bool/number/string）在 json_decode 时还原
                PlanPermission::create([
                    'plan_id'      => $plan->id,
                    'policy_key'   => $key,
                    'policy_value' => json_encode($value, JSON_UNESCAPED_UNICODE),
                ]);
            }
        }
    }

    private function policyMap($permissions): array
    {
        $out = [];
        foreach ($permissions ?? [] as $permission) {
            $out[$permission->policy_key] = $this->decodePolicyValue($permission->policy_value);
        }
        return $out;
    }

    private function decodePolicyValue($value)
    {
        $decoded = json_decode((string)$value, true);
        return $decoded !== null ? $decoded : $value;
    }

    private function normalizeRateLimit(Request $request): array
    {
        $value = $request->has('rate_limit') ? $request->input('rate_limit') : $request->input('rate_limit_json', []);
        return is_array($value) ? $value : [];
    }

    private function nextPlanCode(): string
    {
        $next = ((int) Plan::lockForUpdate()->max('id')) + 1;
        do {
            $code = 'PLAN-' . str_pad((string)$next, 6, '0', STR_PAD_LEFT);
            $exists = Plan::where('code', $code)->exists();
            $next++;
        } while ($exists);

        return $code;
    }

    private function normalizePlanField(string $field, $value)
    {
        if ($value !== null && $value !== '') {
            return $value;
        }
        return match ($field) {
            'price', 'token_quota', 'credit_quota' => 0,
            'storage_quota_bytes' => 0,
            'category_id' => null,
            'duration_days', 'sort' => 0,
            'currency' => 'CNY',
            'quota_refill_cycle' => 'none',
            'description', 'remark' => '',
            default => $value,
        };
    }
}
