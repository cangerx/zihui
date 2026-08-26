<?php

namespace App\Http\Controllers;

use App\Models\BalanceLog;
use App\Models\CloudModel;
use App\Models\ModelAssignment;
use App\Models\UserBalance;
use App\Models\UsageRecord;
use App\Models\BillingRule;
use App\Services\BalanceService;
use App\Services\QuotaService;
use App\Services\RateLimitService;
use Illuminate\Http\Request;

class ClientController extends Controller
{
    public function myModels()
    {
        $user = auth()->user();

        // Get directly assigned model IDs
        $directModelIds = ModelAssignment::where('assignee_type', 'user')
            ->where('assignee_id', $user->id)
            ->pluck('cloud_model_id')
            ->toArray();

        // Get group-assigned model IDs
        $groupIds = $user->groups()->pluck('user_groups.id')->toArray();
        $groupModelIds = [];
        if (!empty($groupIds)) {
            $groupModelIds = ModelAssignment::where('assignee_type', 'group')
                ->whereIn('assignee_id', $groupIds)
                ->pluck('cloud_model_id')
                ->toArray();
        }

        $allModelIds = array_unique(array_merge($directModelIds, $groupModelIds));

        $models = CloudModel::whereIn('id', $allModelIds)
            ->where('status', 'active')
            ->whereHas('provider', fn($q) => $q->where('status', 'active'))
            ->with('provider:id,name,type')
            ->get()
            ->map(fn($m) => [
                'id' => $m->id,
                'model_id' => $m->model_id,
                'name' => $m->name,
                'type' => $m->type,
                'provider_name' => $m->provider->name ?? '',
                'provider_type' => $m->provider->type ?? '',
            ]);

        return response()->json(['models' => $models]);
    }

    public function myPermissions()
    {
        $user = auth()->user();
        $result = app(QuotaService::class)->policies($user);

        // 「灵感大王」权限直接来自 users 表字段，不参与 policy 合并体系
        // 桌面端通过此字段判断创作详情中是否显示「上传到灵感广场」按钮
        $result['inspiration_uploader'] = (bool) $user->inspiration_uploader;

        // 「店铺商品图」两级门控（按商城）：注入 shops 聚合结构 + 旧平铺兼容字段
        $result = array_merge($result, $this->shopProductImagePermissions($result));

        return response()->json(['permissions' => $result]);
    }

    public function myBalanceLogs(Request $request)
    {
        $user = auth()->user();

        $query = BalanceLog::where('user_id', $user->id);

        if ($request->filled('balance_type')) $query->where('balance_type', $request->balance_type);
        if ($request->filled('change_type'))  $query->where('change_type', $request->change_type);

        $logs = $query->orderByDesc('id')->paginate($request->get('per_page', 20));
        return response()->json($logs);
    }

    public function myBalance()
    {
        $user = auth()->user();

        $balances = UserBalance::where('user_id', $user->id)->get()->map(fn($b) => [
            'type' => $b->balance_type,
            'amount' => (float)$b->amount,
        ]);

        return response()->json(['balances' => $balances]);
    }

    public function myQuotas()
    {
        $user = auth()->user();
        $quotaService = app(QuotaService::class);
        $balanceService = app(BalanceService::class);
        $rateLimitService = app(RateLimitService::class);
        $policies = $quotaService->policies($user);

        // 「店铺商品图」两级门控（按商城，与 myPermissions 完全一致；刷新余额时桌面端也能拿到）
        $policies = array_merge($policies, $this->shopProductImagePermissions($policies));

        $planQuotas = $user->planQuotas()
            ->with('userPlan.plan:id,code,name')
            ->orderByRaw('expires_at IS NULL ASC')
            ->orderBy('expires_at')
            ->orderBy('id')
            ->get();

        $activePlanQuotas = $planQuotas->filter(function ($quota) {
            return $quota->status === 'active' && (!$quota->expires_at || $quota->expires_at->gt(now()));
        });

        $balances = [];
        foreach (['token', 'credit'] as $type) {
            $balances[$type] = [
                'wallet' => $balanceService->walletBalance($user->id, $type),
                'plan' => (float)$activePlanQuotas
                    ->where('balance_type', $type)
                    ->sum(fn($quota) => max(0, (float)$quota->granted - (float)$quota->consumed)),
                'total' => $balanceService->totalBalance($user->id, $type),
            ];
        }

        $usageCounters = [];
        foreach (array_keys(QuotaService::COUNTERS) as $counterKey) {
            $usageCounters[$counterKey] = $quotaService->check($user, $counterKey, 1);
        }

        $rateLimits = [];
        foreach (['chat', 'image', 'embedding', 'matting', 'video'] as $scope) {
            $limits = $rateLimitService->effectiveLimits($user, $scope, $policies);
            $rateLimits[$scope] = $limits[$scope] ?? ['rpm' => 0, 'tpm' => 0, 'concurrency' => 0];
        }

        return response()->json([
            'balances' => $balances,
            'plan_quotas' => $planQuotas->map(fn($quota) => [
                'id' => (int)$quota->id,
                'user_plan_id' => (int)$quota->user_plan_id,
                'plan_id' => (int)$quota->plan_id,
                'plan_code' => $quota->userPlan->plan->code ?? '',
                'plan_name' => $quota->userPlan->plan->name ?? '',
                'balance_type' => $quota->balance_type,
                'granted' => (float)$quota->granted,
                'consumed' => (float)$quota->consumed,
                'remaining' => max(0, (float)$quota->granted - (float)$quota->consumed),
                'expires_at' => $quota->expires_at,
                'status' => $quota->status,
            ])->values(),
            'usage_counters' => $usageCounters,
            'rate_limits' => $rateLimits,
            'policies' => $policies,
        ]);
    }

    public function myBillingRules()
    {
        $user = auth()->user();
        $groupIds = $user->groups()->pluck('user_groups.id')->toArray();

        // Get all model IDs assigned to this user
        $directModelIds = ModelAssignment::where('assignee_type', 'user')
            ->where('assignee_id', $user->id)
            ->pluck('cloud_model_id')->toArray();
        $groupModelIds = !empty($groupIds)
            ? ModelAssignment::where('assignee_type', 'group')
                ->whereIn('assignee_id', $groupIds)
                ->pluck('cloud_model_id')->toArray()
            : [];
        $allModelIds = array_unique(array_merge($directModelIds, $groupModelIds));

        // For each model, find the effective billing rule (user > group > default)
        $rules = [];
        foreach ($allModelIds as $modelId) {
            $rule = BillingRule::where('cloud_model_id', $modelId)
                ->where('target_type', 'user')
                ->where('target_id', $user->id)
                ->first();

            if (!$rule && !empty($groupIds)) {
                $rule = BillingRule::where('cloud_model_id', $modelId)
                    ->where('target_type', 'group')
                    ->whereIn('target_id', $groupIds)
                    ->orderBy('input_price')
                    ->first();
            }

            if (!$rule) {
                $rule = BillingRule::where('cloud_model_id', $modelId)
                    ->where('target_type', 'default')
                    ->first();
            }

            if ($rule) {
                $model = CloudModel::find($modelId);
                $rules[] = [
                    'cloud_model_id' => $modelId,
                    'model_name' => $model->name ?? '',
                    'model_id' => $model->model_id ?? '',
                    'model_type' => $model->type ?? '',
                    'billing_type' => $rule->billing_type,
                    'input_price' => (float)$rule->input_price,
                    'output_price' => (float)$rule->output_price,
                    'credit_per_call' => (float)$rule->credit_per_call,
                ];
            }
        }

        return response()->json(['billing_rules' => $rules]);
    }

    public function myUsage(Request $request)
    {
        $user = auth()->user();

        $query = UsageRecord::where('user_id', $user->id)
            ->with('cloudModel:id,model_id,name,type');

        if ($request->filled('type')) {
            $query->where('type', $request->type);
        }
        if ($request->filled('start_date')) {
            $query->where('created_at', '>=', $request->start_date);
        }
        if ($request->filled('end_date')) {
            $query->where('created_at', '<=', $request->end_date . ' 23:59:59');
        }

        $records = $query->orderByDesc('id')->paginate($request->get('per_page', 20));
        return response()->json($records);
    }

    /**
     * 「店铺商品图」按商城下发结构（myPermissions / myQuotas 共用，避免两处漂移）。
     *
     * 输入 $policies 为已合并的 per-user policy map（含 allow_{mall}_shop）。
     * 输出（合并进下发的 permissions / policies）：
     *   - 旧平铺兼容字段（向后兼容旧桌面端）：
     *       allow_ewei_shop(bool)、ewei_shop_mall_name(string)
     *       allow_dianda_shop(bool)、dianda_shop_mall_name(string)
     *   - 新聚合结构 shops = {
     *       "<mall>": { allowed:bool, mall_name:string, real_name:string }, ...
     *     }
     * 其中每个商城 allowed = 二级(per-user policy allow_{mall}_shop) AND 一级(EweiShopAuthorization::isAuthorized(mall))。
     * mall_name 取 SystemSetting 的 {mall}_shop_mall_name（缺省「商城」）；real_name 取平台真名常量。
     */
    private function shopProductImagePermissions(array $policies): array
    {
        $out = ['shops' => []];

        foreach (\App\Services\CloudBuild\EweiShopAuthorization::MALL_KEYS as $mall) {
            $policyKey = 'allow_' . $mall . '_shop';
            $settingKey = $mall . '_shop_mall_name';

            // 二级（per-user policy）AND 一级（云控端被授权端授权该商城）
            $allowed = (bool) ($policies[$policyKey] ?? false)
                && \App\Services\CloudBuild\EweiShopAuthorization::isAuthorized($mall);

            $mallName = (string) \App\Models\SystemSetting::getValue($settingKey, '商城');
            $realName = \App\Models\SystemSetting::SHOP_PLATFORM_LABELS[$mall] ?? $mall;

            // ① 新增聚合结构
            $out['shops'][$mall] = [
                'allowed'   => $allowed,
                'mall_name' => $mallName,
                'real_name' => $realName,
            ];

            // ② 平铺兼容字段（旧 ewei 字段保留 + 新增 dianda 同款平铺字段）
            $out[$policyKey] = $allowed;
            $out[$settingKey] = $mallName;
        }

        return $out;
    }
}
