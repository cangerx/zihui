<?php

namespace App\Http\Controllers;

use App\Models\PermissionPolicy;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

class PermissionController extends Controller
{
    private const NON_CREATABLE_POLICY_KEYS = ['allow_image_gen', 'allow_knowledge_base', 'max_context_messages'];

    public function index(Request $request)
    {
        $query = PermissionPolicy::query();

        if ($request->filled('target_type')) {
            $query->where('target_type', $request->target_type);
        }
        if ($request->filled('target_id')) {
            $query->where('target_id', $request->target_id);
        }
        if ($request->filled('policy_key')) {
            $query->where('policy_key', $request->policy_key);
        }

        $policies = $query->orderByDesc('id')->paginate($request->get('per_page', 50));
        return response()->json($policies);
    }

    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'target_type' => 'required|in:user,group',
            'target_id' => 'required|integer',
            'policy_key' => 'required|string|max:100',
            'policy_value' => 'required',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }
        if (in_array((string) $request->policy_key, self::NON_CREATABLE_POLICY_KEYS, true)) {
            return response()->json(['error' => '该策略尚未接入桌面端，不能新建'], 422);
        }

        // 仅匹配 user-self / group 行（source_plan_id IS NULL），避免与套餐发放的策略冲突
        $policy = PermissionPolicy::updateOrCreate(
            [
                'target_type'    => $request->target_type,
                'target_id'      => $request->target_id,
                'policy_key'     => $request->policy_key,
                'source_plan_id' => null,
            ],
            ['policy_value' => json_encode($request->policy_value, JSON_UNESCAPED_UNICODE)]
        );

        return response()->json($policy, 201);
    }

    public function update(Request $request, $id)
    {
        $policy = PermissionPolicy::findOrFail($id);

        // 套餐发放的策略不允许直接编辑
        if (!is_null($policy->source_plan_id)) {
            return response()->json(['error' => '套餐发放的策略不可直接编辑，请通过套餐管理修改'], 400);
        }

        $validator = Validator::make($request->all(), [
            'policy_value' => 'required',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }
        $policy->policy_value = json_encode($request->policy_value, JSON_UNESCAPED_UNICODE);
        $policy->save();

        return response()->json($policy);
    }

    public function destroy($id)
    {
        PermissionPolicy::findOrFail($id)->delete();
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
     * \u6279\u91cf\u4e3a\u591a\u4e2a target \u914d\u7f6e\u540c\u4e00\u6761\u7b56\u7565\u3002
     * targets[]\uff1a[{"type":"user|group","id":123}, ...]
     * \u4ec5\u64cd\u4f5c source_plan_id=NULL \u7684\u4f4d\u7f6e\uff0c\u4e0e\u5957\u9910\u53d1\u653e\u7684\u7b56\u7565\u4e92\u4e0d\u5e72\u6270
     */
    public function batchStore(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'targets'        => 'required|array|min:1',
            'targets.*.type' => 'required|in:user,group',
            'targets.*.id'   => 'required|integer|min:1',
            'policy_key'     => 'required|string|max:100',
            'policy_value'   => 'required',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }
        if (in_array((string) $request->policy_key, self::NON_CREATABLE_POLICY_KEYS, true)) {
            return response()->json(['error' => '该策略尚未接入桌面端，不能新建'], 422);
        }

        $targets = collect($request->targets)->unique(fn($t) => $t['type'] . ':' . $t['id'])->values();
        $encoded = json_encode($request->policy_value, JSON_UNESCAPED_UNICODE);

        $affected = 0;
        DB::transaction(function () use ($targets, $request, $encoded, &$affected) {
            foreach ($targets as $t) {
                PermissionPolicy::updateOrCreate(
                    [
                        'target_type'    => $t['type'],
                        'target_id'      => $t['id'],
                        'policy_key'     => $request->policy_key,
                        'source_plan_id' => null,
                    ],
                    ['policy_value' => $encoded]
                );
                $affected++;
            }
        });

        return response()->json(['affected' => $affected]);
    }
}
