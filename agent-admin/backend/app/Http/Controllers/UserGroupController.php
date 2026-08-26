<?php

namespace App\Http\Controllers;

use App\Models\UserGroup;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

class UserGroupController extends Controller
{
    public function index(Request $request)
    {
        $query = UserGroup::withCount('members');

        if ($request->filled('keyword')) {
            $query->where('name', 'like', "%{$request->keyword}%");
        }

        $groups = $query->orderByDesc('id')->paginate($request->get('per_page', 50));
        return response()->json($groups);
    }

    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:100|unique:user_groups',
            'description' => 'nullable|string|max:500',
            'is_default' => 'nullable|boolean',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $group = DB::transaction(function () use ($request) {
            $group = UserGroup::create($request->only(['name', 'description', 'is_default']));
            $this->unsetOtherDefaultGroups($group);
            return $group;
        });
        return response()->json($group, 201);
    }

    public function show($id)
    {
        $group = UserGroup::with('members:id,username,nickname,email,status')->withCount('members')->findOrFail($id);
        return response()->json($group);
    }

    public function update(Request $request, $id)
    {
        $group = UserGroup::findOrFail($id);

        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:100|unique:user_groups,name,' . $id,
            'description' => 'nullable|string|max:500',
            'is_default' => 'nullable|boolean',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        DB::transaction(function () use ($request, $group) {
            $group->fill($request->only(['name', 'description', 'is_default']));
            $group->save();
            $this->unsetOtherDefaultGroups($group);
        });

        return response()->json($group);
    }

    public function destroy($id)
    {
        UserGroup::findOrFail($id)->delete();
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

    public function addMembers(Request $request, $id)
    {
        $group = UserGroup::findOrFail($id);

        $validator = Validator::make($request->all(), [
            'user_ids' => 'required|array',
            'user_ids.*' => 'integer|exists:users,id',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        // 单分组独占策略：先清除这些用户的全部分组，再加入当前分组
        $userIds = array_values(array_unique($request->user_ids));
        $now = now();
        DB::transaction(function () use ($userIds, $id, $now) {
            DB::table('user_group_members')
                ->whereIn('user_id', $userIds)
                ->delete();
            $rows = array_map(fn($uid) => [
                'user_id' => $uid,
                'group_id' => $id,
                'created_at' => $now,
            ], $userIds);
            DB::table('user_group_members')->insert($rows);
        });

        return response()->json([
            'message' => 'Members assigned',
            'count' => $group->members()->count(),
            'reassigned' => count($userIds),
        ]);
    }

    public function removeMembers(Request $request, $id)
    {
        $group = UserGroup::findOrFail($id);

        $validator = Validator::make($request->all(), [
            'user_ids' => 'required|array',
            'user_ids.*' => 'integer',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $group->members()->detach($request->user_ids);

        return response()->json(['message' => 'Members removed', 'count' => $group->members()->count()]);
    }

    private function unsetOtherDefaultGroups(UserGroup $group): void
    {
        if (!$group->is_default) {
            return;
        }

        UserGroup::where('id', '<>', $group->id)
            ->where('is_default', true)
            ->update(['is_default' => false]);
    }
}
