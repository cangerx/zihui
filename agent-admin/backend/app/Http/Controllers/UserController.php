<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Models\UserBalance;
use App\Models\PermissionPolicy;
use App\Services\QuotaService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;

class UserController extends Controller
{
    private const MANAGEABLE_CAPABILITIES = [
        'allow_ai_video', 'allow_clawbot', 'allow_custom_provider', 'allow_custom_video_provider',
        'allow_image_matting', 'allow_custom_matting_provider', 'allow_fine_matting', 'allow_ai_mark_removal',
    ];

    public function index(Request $request)
    {
        $query = User::with('groups', 'balances');

        if ($request->filled('status')) {
            $query->where('status', $request->status);
        }
        if ($request->filled('role')) {
            $query->where('role', $request->role);
        }
        if ($request->filled('keyword')) {
            $kw = $request->keyword;
            $query->where(function ($q) use ($kw) {
                $q->where('username', 'like', "%{$kw}%")
                  ->orWhere('nickname', 'like', "%{$kw}%")
                  ->orWhere('email', 'like', "%{$kw}%")
                  ->orWhere('phone', 'like', "%{$kw}%");
            });
        }
        if ($request->filled('group_id')) {
            $query->whereHas('groups', fn($q) => $q->where('user_groups.id', $request->group_id));
        }
        if ($request->filled('oem_project_key')) {
            $query->whereExists(function ($q) use ($request) {
                $q->select(DB::raw(1))
                    ->from('oem_project_members as m')
                    ->whereColumn('m.user_id', 'users.id')
                    ->where('m.oem_project_key', $request->oem_project_key)
                    ->where('m.status', 'active');
            });
        }
        if ($request->filled('has_oem_identity')) {
            $enabled = filter_var($request->has_oem_identity, FILTER_VALIDATE_BOOLEAN);
            $query->{$enabled ? 'whereExists' : 'whereNotExists'}(function ($q) {
                $q->select(DB::raw(1))
                    ->from('oem_project_members as m')
                    ->whereColumn('m.user_id', 'users.id')
                    ->where('m.status', 'active');
            });
        }
        // 时间范围筛选（仪表盘「今日新增用户」「时间区间统计」依赖此字段）
        if ($request->filled('start_date')) {
            $query->where('created_at', '>=', $request->start_date . ' 00:00:00');
        }
        if ($request->filled('end_date')) {
            $query->where('created_at', '<=', $request->end_date . ' 23:59:59');
        }

        $users = $query->orderByDesc('id')->paginate($request->get('per_page', 20));
        $this->attachOemProjectsToPaginator($users);

        return response()->json($users);
    }

    public function capabilities(int $id)
    {
        $user = User::findOrFail($id);
        $resolved = app(QuotaService::class)->policyResolution($user);
        $items = [];
        foreach (self::MANAGEABLE_CAPABILITIES as $key) {
            $entry = $resolved[$key] ?? ['value' => false, 'source' => 'default'];
            $items[] = ['key' => $key, 'value' => (bool) $entry['value'], 'source' => $entry['source']];
        }
        return response()->json(['capabilities' => $items]);
    }

    public function updateCapability(Request $request, int $id, string $key)
    {
        $user = User::findOrFail($id);
        if (!in_array($key, self::MANAGEABLE_CAPABILITIES, true)) {
            return response()->json(['error' => '不支持管理该能力'], 422);
        }
        $payload = $request->validate(['value' => 'required|boolean']);
        PermissionPolicy::updateOrCreate(
            ['target_type' => 'user', 'target_id' => $user->id, 'policy_key' => $key, 'source_plan_id' => null],
            ['policy_value' => json_encode((bool) $payload['value'], JSON_UNESCAPED_UNICODE)]
        );
        $entry = app(QuotaService::class)->policyResolution($user)[$key];
        return response()->json(['capability' => ['key' => $key, 'value' => (bool) $entry['value'], 'source' => $entry['source']]]);
    }

    public function store(Request $request)
    {
        // 用户名/昵称统一字符集：英文 / 数字 / 中文 / 下划线
        // 长度策略：username 6-16，nickname 2-30，nickname 全局 unique
        $nameRegex = '/^[a-zA-Z0-9_\x{4e00}-\x{9fa5}]+$/u';

        $validator = Validator::make($request->all(), [
            'username' => ['required', 'string', 'min:6', 'max:16', 'regex:' . $nameRegex, 'unique:users,username'],
            'password' => 'required|string|min:6|max:100',
            'email' => 'nullable|email|unique:users,email',
            'phone' => 'nullable|string|max:20',
            'nickname' => ['nullable', 'string', 'min:2', 'max:30', 'regex:' . $nameRegex, 'unique:users,nickname'],
            'role' => 'in:admin,user',
            'status' => 'in:active,disabled',
            'remark' => 'nullable|string|max:500',
            'inspiration_uploader' => 'nullable|boolean',
        ], [
            'username.required' => '请输入用户名',
            'username.min' => '用户名长度需 6-16 个字符',
            'username.max' => '用户名长度需 6-16 个字符',
            'username.regex' => '用户名只能包含中文 / 英文 / 数字 / 下划线',
            'username.unique' => '该用户名已被注册',
            'password.required' => '请输入密码',
            'password.min' => '密码至少 6 个字符',
            'email.email' => '邮箱格式不正确',
            'email.unique' => '该邮箱已被使用',
            'nickname.min' => '昵称长度需 2-30 个字符',
            'nickname.max' => '昵称长度需 2-30 个字符',
            'nickname.regex' => '昵称只能包含中文 / 英文 / 数字 / 下划线',
            'nickname.unique' => '该昵称已被使用',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        // 用户与两类初始余额账户必须同事务写入：任一插入失败整体回滚，
        // 避免出现「User 已落库、余额未建」的孤立用户（user_balances 对 user_id+balance_type 有唯一约束）
        $user = DB::transaction(function () use ($request) {
            $user = User::create([
                'username' => $request->username,
                'password' => Hash::make($request->password),
                'email' => $request->email,
                // 手机号空值必须写 NULL（users.phone 有唯一索引 users_phone_unique，
                // 多个 '' 会触发 1062 Duplicate entry；NULL 不受唯一约束，与注册逻辑 AuthController::create 一致）
                'phone' => $request->filled('phone') ? trim((string) $request->phone) : null,
                'nickname' => $request->nickname ?? $request->username,
                'role' => $request->role ?? 'user',
                'status' => $request->status ?? 'active',
                'remark' => $request->remark ?? '',
                'inspiration_uploader' => (bool) $request->boolean('inspiration_uploader'),
            ]);

            // 初始化代币与积分两类余额账户
            UserBalance::create(['user_id' => $user->id, 'balance_type' => 'token', 'amount' => 0]);
            UserBalance::create(['user_id' => $user->id, 'balance_type' => 'credit', 'amount' => 0]);

            return $user;
        });

        $user->load('groups', 'balances');
        return response()->json($user, 201);
    }

    public function show($id)
    {
        $user = User::with('groups', 'balances')->findOrFail($id);
        $user->oem_projects = $this->userOemProjects((int)$user->id);
        return response()->json($user);
    }

    public function update(Request $request, $id)
    {
        $user = User::findOrFail($id);

        // 用户名/昵称统一字符集：英文 / 数字 / 中文 / 下划线
        // 用户名和昵称都允许编辑；用户名是登录账号，修改后用户需用新用户名登录
        $nameRegex = '/^[a-zA-Z0-9_\x{4e00}-\x{9fa5}]+$/u';

        $validator = Validator::make($request->all(), [
            'username' => ['sometimes', 'string', 'min:6', 'max:16', 'regex:' . $nameRegex, 'unique:users,username,' . $id],
            'email' => 'nullable|email|unique:users,email,' . $id,
            'phone' => 'nullable|string|max:20',
            'nickname' => ['nullable', 'string', 'min:2', 'max:30', 'regex:' . $nameRegex, 'unique:users,nickname,' . $id],
            'role' => 'in:admin,user',
            'status' => 'in:active,disabled',
            'remark' => 'nullable|string|max:500',
            'inspiration_uploader' => 'nullable|boolean',
        ], [
            'username.min' => '用户名长度需 6-16 个字符',
            'username.max' => '用户名长度需 6-16 个字符',
            'username.regex' => '用户名只能包含中文 / 英文 / 数字 / 下划线',
            'username.unique' => '该用户名已被注册',
            'email.email' => '邮箱格式不正确',
            'email.unique' => '该邮箱已被使用',
            'nickname.min' => '昵称长度需 2-30 个字符',
            'nickname.max' => '昵称长度需 2-30 个字符',
            'nickname.regex' => '昵称只能包含中文 / 英文 / 数字 / 下划线',
            'nickname.unique' => '该昵称已被使用',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        // 防呆：唯一管理员不允许把自己降级为 user（避免锁死后台）
        if ($request->filled('role') && $request->role !== 'admin'
            && $user->role === 'admin'
            && User::where('role', 'admin')->count() <= 1) {
            return response()->json(['error' => '系统至少需要保留一个管理员，无法将最后一个 admin 改为普通用户'], 400);
        }

        $user->fill($request->only(['username', 'email', 'nickname', 'role', 'status', 'remark']));
        // 手机号单独规范化：空值统一写 NULL（同 store()，避免编辑用户时写入 '' 撞 users_phone_unique）
        if ($request->has('phone')) {
            $user->phone = $request->filled('phone') ? trim((string) $request->phone) : null;
        }
        if ($request->has('inspiration_uploader')) {
            $user->inspiration_uploader = (bool) $request->boolean('inspiration_uploader');
        }
        $user->save();
        $user->load('groups', 'balances');
        $user->oem_projects = $this->userOemProjects((int)$user->id);

        return response()->json($user);
    }

    public function destroy($id)
    {
        $user = User::findOrFail($id);
        if ($user->role === 'admin' && User::where('role', 'admin')->count() <= 1) {
            return response()->json(['error' => 'Cannot delete the last admin'], 400);
        }
        $user->delete();
        return response()->json(['message' => 'Deleted']);
    }

    /**
     * 批量删除：循环调用 destroy，复用单条业务校验（含「最后一个 admin 不可删」）。
     * 额外校验：禁止把当前登录用户包含在批量列表里。
     */
    public function batchDestroy(Request $request)
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', (array) $request->input('ids', [])))));
        if (empty($ids)) {
            return response()->json(['error' => 'ids 不能为空'], 400);
        }
        if (count($ids) > 200) {
            return response()->json(['error' => '单次批量操作不超过 200 条'], 400);
        }

        $me = auth()->id();
        if ($me && in_array($me, $ids, true)) {
            return response()->json(['error' => '不能删除当前登录账户，请先取消选择自己'], 400);
        }

        $deleted = 0;
        $errors = [];
        foreach ($ids as $id) {
            try {
                $resp = $this->destroy($id);
                $data = $resp->getData(true);
                if ($resp->getStatusCode() >= 400) {
                    $errors[] = ['id' => $id, 'error' => $data['error'] ?? ('HTTP ' . $resp->getStatusCode())];
                    continue;
                }
                $deleted++;
            } catch (\Throwable $e) {
                $errors[] = ['id' => $id, 'error' => $e->getMessage()];
            }
        }

        return response()->json([
            'deleted' => $deleted,
            'errors'  => $errors,
            'total'   => count($ids),
        ]);
    }

    /**
     * 批量设置「灵感大王」权限。
     * 拥有此权限的用户在桌面端可将创作上传到灵感广场。
     * body: { ids: int[], inspiration_uploader: bool }
     */
    public function batchSetInspirationUploader(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'ids' => 'required|array',
            'ids.*' => 'integer',
            'inspiration_uploader' => 'required|boolean',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $ids = array_values(array_unique(array_filter(array_map('intval', $request->input('ids', [])))));
        if (empty($ids)) {
            return response()->json(['error' => 'ids 不能为空'], 400);
        }
        if (count($ids) > 200) {
            return response()->json(['error' => '单次批量操作不超过 200 条'], 400);
        }

        $value = (bool) $request->boolean('inspiration_uploader');
        $affected = User::whereIn('id', $ids)->update(['inspiration_uploader' => $value]);

        return response()->json([
            'updated' => $affected,
            'total' => count($ids),
            'inspiration_uploader' => $value,
        ]);
    }

    public function resetPassword(Request $request, $id)
    {
        $validator = Validator::make($request->all(), [
            'password' => 'required|string|min:6|max:100',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $user = User::findOrFail($id);
        $user->password = Hash::make($request->password);
        $user->save();

        return response()->json(['message' => 'Password reset']);
    }

    public function toggleStatus($id)
    {
        $user = User::findOrFail($id);
        $user->status = $user->status === 'active' ? 'disabled' : 'active';
        $user->save();
        return response()->json(['status' => $user->status]);
    }

    public function oemProjects($id)
    {
        $user = User::findOrFail($id);
        return response()->json([
            'user_id' => (int)$user->id,
            'projects' => $this->userOemProjects((int)$user->id),
        ]);
    }

    public function syncOemProjects(Request $request, $id)
    {
        $user = User::findOrFail($id);
        $validator = Validator::make($request->all(), [
            'projects' => 'present|array',
            'projects.*.oem_project_key' => 'required|string|max:64|exists:oem_projects,project_key',
            'projects.*.role' => 'nullable|in:owner,manager',
            'projects.*.status' => 'nullable|in:active,disabled',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }
        DB::transaction(function () use ($request, $user) {
            DB::table('oem_project_members')->where('user_id', $user->id)->delete();
            $now = now();
            $seen = [];
            foreach ((array)$request->input('projects', []) as $project) {
                $key = (string)$project['oem_project_key'];
                if (isset($seen[$key])) {
                    continue;
                }
                $seen[$key] = true;
                DB::table('oem_project_members')->insert([
                    'oem_project_key' => $key,
                    'user_id' => (int)$user->id,
                    'role' => (string)($project['role'] ?? 'owner'),
                    'status' => (string)($project['status'] ?? 'active'),
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        });
        return response()->json([
            'user_id' => (int)$user->id,
            'projects' => $this->userOemProjects((int)$user->id),
        ]);
    }

    private function attachOemProjectsToPaginator($paginator): void
    {
        $items = collect($paginator->items());
        $ids = $items->pluck('id')->map(fn($v) => (int)$v)->all();
        if (empty($ids)) {
            return;
        }
        $rows = DB::table('oem_project_members as m')
            ->join('oem_projects as p', 'p.project_key', '=', 'm.oem_project_key')
            ->whereIn('m.user_id', $ids)
            ->whereNull('p.deleted_at')
            ->select('m.user_id', 'm.oem_project_key', 'm.role', 'm.status', 'p.name', 'p.app_name', 'p.status as project_status')
            ->orderBy('p.id')
            ->get()
            ->groupBy('user_id');
        foreach ($items as $user) {
            $user->oem_projects = ($rows->get($user->id) ?: collect())->values();
        }
    }

    private function userOemProjects(int $userId)
    {
        return DB::table('oem_project_members as m')
            ->join('oem_projects as p', 'p.project_key', '=', 'm.oem_project_key')
            ->where('m.user_id', $userId)
            ->whereNull('p.deleted_at')
            ->select('m.oem_project_key', 'm.role', 'm.status', 'p.name', 'p.app_name', 'p.status as project_status', 'm.created_at', 'm.updated_at')
            ->orderBy('p.id')
            ->get();
    }
}
