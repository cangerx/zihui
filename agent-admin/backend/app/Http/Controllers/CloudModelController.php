<?php

namespace App\Http\Controllers;

use App\Models\BillingRule;
use App\Models\CloudModel;
use App\Models\CloudProvider;
use App\Models\ModelAssignment;
use App\Models\PlanModelAssignment;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

class CloudModelController extends Controller
{
    public function index(Request $request)
    {
        $query = CloudModel::with('provider:id,name,type,status');

        if ($request->filled('provider_id')) {
            $query->where('provider_id', $request->provider_id);
        }
        if ($request->filled('type')) {
            $query->where('type', $request->type);
        }
        if ($request->filled('status')) {
            $query->where('status', $request->status);
        }
        if ($request->filled('keyword')) {
            $kw = $request->keyword;
            $query->where(function ($q) use ($kw) {
                $q->where('name', 'like', "%{$kw}%")
                  ->orWhere('model_id', 'like', "%{$kw}%");
            });
        }

        $models = $query->orderByDesc('id')->paginate($request->get('per_page', 50));
        $ids = $models->getCollection()->pluck('id')->all();
        $priced = [];
        $assigned = [];
        if ($ids) {
            $priced = BillingRule::query()
                ->whereIn('cloud_model_id', $ids)
                ->where('target_type', 'default')
                ->pluck('cloud_model_id')
                ->all();
            $direct = ModelAssignment::query()
                ->whereIn('cloud_model_id', $ids)
                ->pluck('cloud_model_id')
                ->all();
            $plan = PlanModelAssignment::query()
                ->whereIn('cloud_model_id', $ids)
                ->whereHas('plan', fn ($q) => $q->where('status', 'active'))
                ->pluck('cloud_model_id')
                ->all();
            $assigned = array_values(array_unique(array_merge($direct, $plan)));
        }
        $pricedSet = array_fill_keys($priced, true);
        $assignedSet = array_fill_keys($assigned, true);
        $models->getCollection()->transform(function ($model) use ($pricedSet, $assignedSet) {
            $model->setAttribute('has_default_billing', isset($pricedSet[$model->id]));
            $model->setAttribute('is_assigned', isset($assignedSet[$model->id]));
            return $model;
        });

        return response()->json($models);
    }

    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'provider_id' => 'required|integer|exists:cloud_providers,id',
            'model_id' => 'required|string|max:200',
            'name' => 'required|string|max:200',
            'type' => 'required|in:chat,image,embedding',
            'status' => 'in:active,disabled',
            'remark' => 'nullable|string|max:500',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $payload = $request->only(['provider_id', 'model_id', 'name', 'type', 'status', 'remark']);
        // 多米服务商服务端兜底：model_id 强制 gpt-image-2 · type=image。
        // 避免（1）前端锁定被绕过 （2）API 直接调用 （3）批量导入透传非法 model_id。
        $payload = $this->enforceDuoMiModelConstraints((int) $payload['provider_id'], $payload);

        $exists = CloudModel::where('provider_id', $payload['provider_id'])
            ->where('model_id', $payload['model_id'])->exists();
        if ($exists) {
            return response()->json(['error' => 'Model already exists for this provider'], 422);
        }

        $model = CloudModel::create($payload);
        $model->load('provider:id,name,type,status');

        return response()->json($model, 201);
    }

    public function batchStore(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'provider_id' => 'required|integer|exists:cloud_providers,id',
            'models' => 'required|array|min:1',
            'models.*.model_id' => 'required|string|max:200',
            'models.*.name' => 'required|string|max:200',
            'models.*.type' => 'required|in:chat,image,embedding',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $created = 0;
        $skipped = 0;
        $createdIds = [];
        $providerId = (int) $request->provider_id;

        foreach ($request->models as $m) {
            // 同 store()：duomi 服务商下批量导入也强制 model_id=gpt-image-2 + type=image。
            // 多条导入时被去重为单条 gpt-image-2，后面重复的走 exists 分支 → skipped++。
            $row = $this->enforceDuoMiModelConstraints($providerId, [
                'provider_id' => $providerId,
                'model_id' => $m['model_id'],
                'name' => $m['name'],
                'type' => $m['type'],
                'status' => 'active',
            ]);

            $exists = CloudModel::where('provider_id', $row['provider_id'])
                ->where('model_id', $row['model_id'])->exists();
            if ($exists) {
                $skipped++;
                continue;
            }

            $createdIds[] = CloudModel::create($row)->id;
            $created++;
        }

        return response()->json(['created' => $created, 'skipped' => $skipped, 'created_ids' => $createdIds]);
    }

    public function show($id)
    {
        $model = CloudModel::with('provider:id,name,type,status', 'billingRules')->findOrFail($id);
        return response()->json($model);
    }

    public function update(Request $request, $id)
    {
        $model = CloudModel::findOrFail($id);

        $validator = Validator::make($request->all(), [
            'name' => 'string|max:200',
            'type' => 'in:chat,image,embedding',
            'status' => 'in:active,disabled',
            'remark' => 'nullable|string|max:500',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $payload = $request->only(['name', 'type', 'status', 'remark']);
        // duomi 服务商下：type 强制 image（model_id 不允许 update，仅走 type 路径）。
        $payload = $this->enforceDuoMiModelConstraints((int) $model->provider_id, $payload);

        $model->fill($payload);
        $model->save();

        return response()->json($model);
    }

    /**
     * 多米服务商限定规则（服务端兼容层）。
     *
     * 官方文档（https://duomiapi.com/doc/55）当前仅列 gpt-image-2 一个模型、且仅为图像生成。
     * 本函数在 store / batchStore / update 三个入口统一调用：provider.type=duomi 时强制
     * 改写 model_id='gpt-image-2' 与 type='image'。错误的 model_id 不报错而是静默改写，
     * 避免用户手工调 API 或老脚本透传时报 422。与 Adapter 层 cleanseDuoMiBody 形成双重防御。
     */
    private function enforceDuoMiModelConstraints(?int $providerId, array $payload): array
    {
        if (!$providerId) return $payload;
        $type = CloudProvider::where('id', $providerId)->value('type');
        if ($type !== 'duomi') return $payload;

        if (array_key_exists('model_id', $payload)) {
            $payload['model_id'] = 'gpt-image-2';
        }
        if (array_key_exists('type', $payload)) {
            $payload['type'] = 'image';
        }
        return $payload;
    }

    public function destroy($id)
    {
        CloudModel::findOrFail($id)->delete();
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
}
