<?php

namespace App\Http\Controllers;

use App\Models\ModelAssignment;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

class ModelAssignmentController extends Controller
{
    public function index(Request $request)
    {
        $query = ModelAssignment::with('cloudModel.provider:id,name');

        if ($request->filled('assignee_type')) {
            $query->where('assignee_type', $request->assignee_type);
        }
        if ($request->filled('assignee_id')) {
            $query->where('assignee_id', $request->assignee_id);
        }
        if ($request->filled('cloud_model_id')) {
            $query->where('cloud_model_id', $request->cloud_model_id);
        }

        $assignments = $query->orderByDesc('id')->paginate($request->get('per_page', 50));
        return response()->json($assignments);
    }

    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'cloud_model_id' => 'required|integer|exists:cloud_models,id',
            'assignee_type' => 'required|in:user,group',
            'assignee_id' => 'required|integer',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $exists = ModelAssignment::where('cloud_model_id', $request->cloud_model_id)
            ->where('assignee_type', $request->assignee_type)
            ->where('assignee_id', $request->assignee_id)
            ->exists();

        if ($exists) {
            return response()->json(['error' => 'Assignment already exists'], 422);
        }

        $assignment = ModelAssignment::create($request->only([
            'cloud_model_id', 'assignee_type', 'assignee_id',
        ]));

        $assignment->load('cloudModel.provider:id,name');
        return response()->json($assignment, 201);
    }

    public function destroy($id)
    {
        ModelAssignment::findOrFail($id)->delete();
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

    public function batchStore(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'assignments' => 'required|array|min:1',
            'assignments.*.cloud_model_id' => 'required|integer|exists:cloud_models,id',
            'assignments.*.assignee_type' => 'required|in:user,group',
            'assignments.*.assignee_id' => 'required|integer',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $created = 0;
        $skipped = 0;

        foreach ($request->assignments as $a) {
            $exists = ModelAssignment::where('cloud_model_id', $a['cloud_model_id'])
                ->where('assignee_type', $a['assignee_type'])
                ->where('assignee_id', $a['assignee_id'])
                ->exists();

            if ($exists) {
                $skipped++;
                continue;
            }

            ModelAssignment::create($a);
            $created++;
        }

        return response()->json(['created' => $created, 'skipped' => $skipped]);
    }

    /**
     * 矩阵批量分配：cloud_model_ids[] × targets[] 展开成 N×M 条
     * targets[] 格式：[{"type":"user|group","id":123}, ...]
     * 已存在的跳过（幂等）
     */
    public function batchMatrix(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'cloud_model_ids'   => 'required|array|min:1',
            'cloud_model_ids.*' => 'integer|exists:cloud_models,id',
            'targets'           => 'required|array|min:1',
            'targets.*.type'    => 'required|in:user,group',
            'targets.*.id'      => 'required|integer|min:1',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $modelIds = array_values(array_unique($request->cloud_model_ids));
        $targets  = collect($request->targets)->unique(fn($t) => $t['type'] . ':' . $t['id'])->values();

        $created = 0;
        $skipped = 0;

        DB::transaction(function () use ($modelIds, $targets, &$created, &$skipped) {
            foreach ($modelIds as $mid) {
                foreach ($targets as $t) {
                    $exists = ModelAssignment::where('cloud_model_id', $mid)
                        ->where('assignee_type', $t['type'])
                        ->where('assignee_id', $t['id'])
                        ->exists();
                    if ($exists) {
                        $skipped++;
                        continue;
                    }
                    ModelAssignment::create([
                        'cloud_model_id' => $mid,
                        'assignee_type'  => $t['type'],
                        'assignee_id'    => $t['id'],
                    ]);
                    $created++;
                }
            }
        });

        return response()->json([
            'created' => $created,
            'skipped' => $skipped,
            'total'   => count($modelIds) * $targets->count(),
        ]);
    }
}
