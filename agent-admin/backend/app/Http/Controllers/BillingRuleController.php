<?php

namespace App\Http\Controllers;

use App\Models\BillingRule;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

class BillingRuleController extends Controller
{
    public function index(Request $request)
    {
        $query = BillingRule::with([
            'cloudModel:id,provider_id,model_id,name,type',
            'cloudModel.provider:id,name',
        ]);

        if ($request->filled('cloud_model_id')) {
            $query->where('cloud_model_id', $request->cloud_model_id);
        }
        if ($request->filled('target_type')) {
            $query->where('target_type', $request->target_type);
        }
        if ($request->filled('target_id')) {
            $query->where('target_id', $request->target_id);
        }

        // 按目标用户名 / 昵称搜索：同时搜 users 表的 username + nickname 和 user_groups 表的 name。
        // 命中的 user / group 的 id 会带出其对应的计费规则，target_type='default' 的规则不参与此过滤。
        if ($request->filled('target_keyword')) {
            $k = (string) $request->input('target_keyword');
            $query->where(function ($q) use ($k) {
                $q->where(function ($qq) use ($k) {
                    $qq->where('target_type', 'user')
                        ->whereIn('target_id', function ($sub) use ($k) {
                            $sub->select('id')->from('users')
                                ->where('username', 'like', "%{$k}%")
                                ->orWhere('nickname', 'like', "%{$k}%");
                        });
                })->orWhere(function ($qq) use ($k) {
                    $qq->where('target_type', 'group')
                        ->whereIn('target_id', function ($sub) use ($k) {
                            $sub->select('id')->from('user_groups')
                                ->where('name', 'like', "%{$k}%");
                        });
                });
            });
        }

        $rules = $query->orderByDesc('id')->paginate($request->get('per_page', 50));
        return response()->json($rules);
    }

    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'cloud_model_id' => 'required|integer|exists:cloud_models,id',
            'target_type' => 'in:default,user,group',
            'target_id' => 'integer',
            'billing_type' => 'required|in:token,credit',
            'input_price' => 'nullable|numeric|min:0',
            'output_price' => 'nullable|numeric|min:0',
            'credit_per_call' => 'nullable|numeric|min:0',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $rule = BillingRule::updateOrCreate(
            [
                'cloud_model_id' => $request->cloud_model_id,
                'target_type' => $request->target_type ?? 'default',
                'target_id' => $request->target_id ?? 0,
            ],
            $this->normalizeBillingFields($request->only(['billing_type', 'input_price', 'output_price', 'credit_per_call']))
        );

        return response()->json($rule, 201);
    }

    public function update(Request $request, $id)
    {
        $rule = BillingRule::findOrFail($id);

        $validator = Validator::make($request->all(), [
            'billing_type' => 'in:token,credit',
            'input_price' => 'nullable|numeric|min:0',
            'output_price' => 'nullable|numeric|min:0',
            'credit_per_call' => 'nullable|numeric|min:0',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $rule->fill($this->normalizeBillingFields($request->only(['billing_type', 'input_price', 'output_price', 'credit_per_call'])));
        $rule->save();

        return response()->json($rule);
    }

    public function destroy($id)
    {
        BillingRule::findOrFail($id)->delete();
        return response()->json(['message' => 'Deleted']);
    }

    /** 批量删除：循环调用 destroy，收集 errors */
    public function batchDestroy(Request $request)
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', (array) $request->input('ids', [])))));
        if (empty($ids)) return response()->json(['error' => 'ids 不能为空'], 400);
        if (count($ids) > 200) return response()->json(['error' => '单次批量操作不超过 200 条'], 400);

        $deleted = 0; $errors = [];
        foreach ($ids as $id) {
            try {
                $resp = $this->destroy($id);
                if ($resp->getStatusCode() >= 400) {
                    $data = $resp->getData(true);
                    $errors[] = ['id' => $id, 'error' => $data['error'] ?? ('HTTP ' . $resp->getStatusCode())];
                    continue;
                }
                $deleted++;
            } catch (\Throwable $e) {
                $errors[] = ['id' => $id, 'error' => $e->getMessage()];
            }
        }
        return response()->json(['deleted' => $deleted, 'errors' => $errors, 'total' => count($ids)]);
    }

    /**
     * \u6279\u91cf\u4e3a\u591a\u4e2a target \u914d\u7f6e\u540c\u4e00\u6761\u8ba1\u8d39\u89c4\u5219\u3002
     * targets[]\uff1a[{"type":"user|group","id":123}, ...]
     * updateOrCreate \u5e42\u7b49\u3002
     */
    public function batchStore(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'cloud_model_id'  => 'required|integer|exists:cloud_models,id',
            'targets'         => 'required|array|min:1',
            'targets.*.type'  => 'required|in:user,group',
            'targets.*.id'    => 'required|integer|min:1',
            'billing_type'    => 'required|in:token,credit',
            'input_price'     => 'nullable|numeric|min:0',
            'output_price'    => 'nullable|numeric|min:0',
            'credit_per_call' => 'nullable|numeric|min:0',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $targets = collect($request->targets)->unique(fn($t) => $t['type'] . ':' . $t['id'])->values();
        $fields  = $this->normalizeBillingFields($request->only(['billing_type', 'input_price', 'output_price', 'credit_per_call']));

        $affected = 0;
        DB::transaction(function () use ($targets, $request, $fields, &$affected) {
            foreach ($targets as $t) {
                BillingRule::updateOrCreate(
                    [
                        'cloud_model_id' => $request->cloud_model_id,
                        'target_type'    => $t['type'],
                        'target_id'      => $t['id'],
                    ],
                    $fields
                );
                $affected++;
            }
        });

        return response()->json(['affected' => $affected]);
    }

    private function normalizeBillingFields(array $fields): array
    {
        foreach (['input_price', 'output_price', 'credit_per_call'] as $field) {
            if (array_key_exists($field, $fields) && ($fields[$field] === null || $fields[$field] === '')) {
                $fields[$field] = 0;
            }
        }
        return $fields;
    }
}
