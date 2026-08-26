<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\Mall\MallAuthorizationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class BuildClientController extends Controller
{
    /**
     * 0.2.0 起，授权模型简化为「仅域名校验」：
     *   - client_id 仅作为内部稳定主键（auto-gen，不对外暴露给云控端）
     *   - 不再有 client_secret / api_domain / contact 字段
     *   - 仅靠 authorized_clients.domain 校验入站请求 Origin 是否授权
     */
    private const SELECT_COLS = [
        'client_id', 'domain', 'owner_name', 'owner_phone',
        'daily_limit', 'monthly_limit', 'status', 'expires_at',
        'is_hub_reviewer', 'maintenance_exempt', 'can_use_ewei_shop',
        'can_use_github_packaging', 'can_use_mac_packaging',
        'created_at', 'updated_at',
    ];

    /**
     * 商城授权读写收口到 MallAuthorizationService（含 upsert 语义 + ewei 旧列双写 + 读回退）。
     * 合法 mall_key 枚举（'ewei' / 'dianda' / 'qdyun'）统一引用 MallAuthorizationService::MALL_KEYS，
     * 本控制器不再持有自己的副本，避免三端枚举漂移。
     */
    public function __construct(private MallAuthorizationService $mallAuth)
    {
    }

    /** GET /admin/api/clients */
    public function index(Request $request): JsonResponse
    {
        $page = max(1, (int) $request->query('page', 1));
        $pageSize = min(100, max(1, (int) $request->query('page_size', 20)));
        $search = trim((string) $request->query('search', ''));
        $statusFilter = $request->query('status');

        $q = DB::table('authorized_clients');
        if ($search !== '') {
            $like = '%' . $search . '%';
            $q->where(function ($w) use ($like) {
                $w->where('domain', 'LIKE', $like)
                  ->orWhere('owner_name', 'LIKE', $like)
                  ->orWhere('owner_phone', 'LIKE', $like);
            });
        }
        if ($statusFilter && in_array($statusFilter, ['active', 'suspended', 'expired'], true)) {
            $q->where('status', $statusFilter);
        }

        $total = $q->count();
        $rows = $q->orderByDesc('created_at')
            ->skip(($page - 1) * $pageSize)
            ->take($pageSize)
            ->get(self::SELECT_COLS);

        // 聚合每个客户端的「今日已用」「本月已用」打包次数。
        // 仅对当前分页的 client_id 集合查询，避免大表全量扫。
        $clientIds = $rows->pluck('client_id')->all();
        $dailyMap = [];
        $monthlyMap = [];
        if (!empty($clientIds)) {
            $today = now()->toDateString();
            $monthStart = now()->startOfMonth()->toDateString();

            $dailyRows = DB::table('build_quotas')
                ->whereIn('client_id', $clientIds)
                ->where('date', $today)
                ->get(['client_id', 'count']);
            foreach ($dailyRows as $dr) {
                $dailyMap[$dr->client_id] = (int) $dr->count;
            }

            $monthlyRows = DB::table('build_quotas')
                ->whereIn('client_id', $clientIds)
                ->where('date', '>=', $monthStart)
                ->groupBy('client_id')
                ->select('client_id', DB::raw('SUM(count) as total'))
                ->get();
            foreach ($monthlyRows as $mr) {
                $monthlyMap[$mr->client_id] = (int) $mr->total;
            }
        }

        // 聚合每个客户端的「按商城」一级授权 map（{ewei:bool,dianda:bool,qdyun:bool}），供前端按商城渲染开关。
        // ewei 回退旧列 can_use_ewei_shop（未迁移到关联表的存量客户端不掉权）。
        // 一次 whereIn 查询批量取回，ewei 回退所需的旧列已在 $rows（SELECT_COLS 含 can_use_ewei_shop）。
        $mallAuthMap = $this->mallAuth->getAuthorizationsBatch($rows);

        $items = $rows->map(function ($r) use ($dailyMap, $monthlyMap, $mallAuthMap) {
            $r->daily_used = $dailyMap[$r->client_id] ?? 0;
            $r->monthly_used = $monthlyMap[$r->client_id] ?? 0;
            // 按商城授权 map：{ ewei: bool, dianda: bool, qdyun: bool }
            $r->mall_authorizations = $mallAuthMap[$r->client_id] ?? [];
            return $r;
        });

        return response()->json([
            'total' => $total,
            'page' => $page,
            'page_size' => $pageSize,
            'items' => $items,
        ], 200);
    }

    /** GET /admin/api/clients/{clientId} */
    public function show(string $clientId): JsonResponse
    {
        $client = DB::table('authorized_clients')->where('client_id', $clientId)->first(self::SELECT_COLS);
        if (!$client) {
            return response()->json(['error' => 'client_not_found'], 404);
        }
        return response()->json($client, 200);
    }

    /**
     * 归一化授权域名输入 → 标准存储形态 https://host[:port]。
     * 0.13.0 起支持：域名 / 纯 IP / IP:端口 / 带不带 http(s) 前缀 / 尾斜杠 / 大小写混写
     * （IP 部署的云控端同样是受支持的授权形态）。提取不出 host 返回 null。
     * 校验中间件按 host 比对（忽略 scheme / 端口），存储形态仅作展示与查重锚点。
     */
    private function normalizeDomainInput(string $raw): ?string
    {
        $raw = rtrim(trim($raw), '/');
        if ($raw === '') {
            return null;
        }
        if (!preg_match('#^[a-z][a-z0-9+\-.]*://#i', $raw)) {
            $raw = 'https://' . $raw;
        }
        $parts = parse_url($raw);
        $host = $parts['host'] ?? null;
        if (!is_string($host) || $host === '') {
            return null;
        }
        $normalized = 'https://' . strtolower($host);
        if (isset($parts['port'])) {
            $normalized .= ':' . $parts['port'];
        }
        return $normalized;
    }

    /**
     * host 级查重：与 VerifyDomainBinding 慢路径同款宽松匹配。
     * 避免 https://a.com 与 a.com、http://1.2.3.4 与 1.2.3.4:8080 被当成两个不同授权
     * （校验中间件忽略 scheme / 端口，这类「重复」实际命中同一行，必须在录入时拦住）。
     */
    private function domainHostTaken(string $normalizedDomain, ?string $excludeClientId = null): bool
    {
        $host = strtolower((string) parse_url($normalizedDomain, PHP_URL_HOST));
        if ($host === '') {
            return false;
        }
        $rows = DB::table('authorized_clients')->select('client_id', 'domain')->get();
        foreach ($rows as $row) {
            if ($excludeClientId !== null && $row->client_id === $excludeClientId) {
                continue;
            }
            $existing = (string) $row->domain;
            if (!preg_match('#^[a-z][a-z0-9+\-.]*://#i', $existing)) {
                $existing = 'https://' . $existing;
            }
            $existingHost = strtolower((string) parse_url($existing, PHP_URL_HOST));
            if ($existingHost !== '' && $existingHost === $host) {
                return true;
            }
        }
        return false;
    }

    /** POST /admin/api/clients */
    public function store(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            // 0.13.0：'url' 规则改为 string + 自定义归一化（支持纯 IP / IP:端口 / 无 scheme）
            'domain' => ['required', 'string', 'max:255'],
            'owner_name' => ['required', 'string', 'max:100'],
            'owner_phone' => ['nullable', 'string', 'max:30'],
            'daily_limit' => ['integer', 'min:1', 'max:1000'],
            'monthly_limit' => ['integer', 'min:1', 'max:10000'],
            'expires_at' => ['nullable', 'date'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $domain = $this->normalizeDomainInput((string) $request->input('domain'));
        if ($domain === null) {
            return response()->json([
                'error' => 'invalid_domain',
                'message' => '域名格式不正确：支持域名 / IP / IP:端口，可不带 http(s) 前缀',
            ], 422);
        }
        if ($this->domainHostTaken($domain)) {
            return response()->json(['error' => 'domain_taken', 'domain' => $domain], 409);
        }

        // client_id 仅作为内部稳定主键，自动生成（保持与 build_requests / build_quotas 外键关系不变）
        do {
            $clientId = 'client_' . Str::lower(Str::random(12));
        } while (DB::table('authorized_clients')->where('client_id', $clientId)->exists());

        $now = now();

        DB::table('authorized_clients')->insert([
            'client_id' => $clientId,
            'domain' => $domain,
            'owner_name' => $request->input('owner_name'),
            'owner_phone' => $request->input('owner_phone'),
            'daily_limit' => (int) $request->input('daily_limit', 3),
            'monthly_limit' => (int) $request->input('monthly_limit', 30),
            'status' => 'active',
            'expires_at' => $request->input('expires_at'),
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return response()->json([
            'client_id' => $clientId,
            'domain' => $domain,
        ], 201);
    }

    /** PATCH /admin/api/clients/{clientId} */
    public function update(Request $request, string $clientId): JsonResponse
    {
        $client = DB::table('authorized_clients')->where('client_id', $clientId)->first();
        if (!$client) {
            return response()->json(['error' => 'client_not_found'], 404);
        }

        $validator = Validator::make($request->all(), [
            // 0.13.0：'url' 规则改为 string + 自定义归一化（支持纯 IP / IP:端口 / 无 scheme）
            'domain' => ['sometimes', 'string', 'max:255'],
            'owner_name' => ['sometimes', 'string', 'max:100'],
            'owner_phone' => ['sometimes', 'nullable', 'string', 'max:30'],
            'daily_limit' => ['sometimes', 'integer', 'min:1', 'max:1000'],
            'monthly_limit' => ['sometimes', 'integer', 'min:1', 'max:10000'],
            'status' => ['sometimes', 'in:active,suspended,expired'],
            'expires_at' => ['sometimes', 'nullable', 'date'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $update = ['updated_at' => now()];
        foreach (['domain', 'owner_name', 'owner_phone', 'daily_limit', 'monthly_limit', 'status', 'expires_at'] as $key) {
            if ($request->has($key)) {
                $val = $request->input($key);
                if ($key === 'domain' && is_string($val)) {
                    $val = $this->normalizeDomainInput($val);
                    if ($val === null) {
                        return response()->json([
                            'error' => 'invalid_domain',
                            'message' => '域名格式不正确：支持域名 / IP / IP:端口，可不带 http(s) 前缀',
                        ], 422);
                    }
                    if ($this->domainHostTaken($val, $clientId)) {
                        return response()->json(['error' => 'domain_taken', 'domain' => $val], 409);
                    }
                }
                $update[$key] = $val;
            }
        }

        DB::table('authorized_clients')->where('client_id', $clientId)->update($update);

        return response()->json(['status' => 'updated'], 200);
    }

    /** DELETE /admin/api/clients/{clientId} */
    public function destroy(string $clientId): JsonResponse
    {
        $client = DB::table('authorized_clients')->where('client_id', $clientId)->first();
        if (!$client) {
            return response()->json(['error' => 'client_not_found'], 404);
        }

        $active = DB::table('build_requests')
            ->where('client_id', $clientId)
            ->whereIn('status', ['pending', 'queued', 'building'])
            ->count();
        if ($active > 0) {
            return response()->json(['error' => 'client_has_active_builds', 'active_count' => $active], 409);
        }

        DB::transaction(function () use ($clientId) {
            DB::table('build_quotas')->where('client_id', $clientId)->delete();
            // 关联表无外键级联，需手动清理，避免遗留孤儿授权行（且防新客户端复用旧 id 时继承旧授权）
            DB::table('client_mall_authorizations')->where('client_id', $clientId)->delete();
            DB::table('authorized_clients')->where('client_id', $clientId)->delete();
        });

        return response()->json(['status' => 'deleted'], 200);
    }

    /**
     * POST /admin/api/clients/batch-import
     * Body: { domains: string[], owner_name: string, owner_phone?, daily_limit?, monthly_limit?, expires_at? }
     * 所有 domain 共用一套 owner / 配额设置；notify_url 由后端从 domain 自动拼接。
     */
    public function batchImport(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'domains' => ['required', 'array', 'min:1', 'max:500'],
            'domains.*' => ['required', 'string', 'max:255'],
            'owner_name' => ['required', 'string', 'max:100'],
            'owner_phone' => ['nullable', 'string', 'max:30'],
            'daily_limit' => ['integer', 'min:1', 'max:1000'],
            'monthly_limit' => ['integer', 'min:1', 'max:10000'],
            'expires_at' => ['nullable', 'date'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $ownerName = (string) $request->input('owner_name');
        $ownerPhone = $request->input('owner_phone');
        $dailyLimit = (int) $request->input('daily_limit', 3);
        $monthlyLimit = (int) $request->input('monthly_limit', 30);
        $expiresAt = $request->input('expires_at');

        $now = now();
        $results = [];
        $successCount = 0;
        $failedCount = 0;

        foreach ($request->input('domains') as $raw) {
            // 0.13.0：与单个添加同款归一化（支持纯 IP / IP:端口 / 无 scheme）+ host 级查重
            $domain = $this->normalizeDomainInput((string) $raw);

            if ($domain === null) {
                $results[] = ['input' => (string) $raw, 'status' => 'invalid', 'error' => 'invalid_domain'];
                $failedCount++;
                continue;
            }
            if ($this->domainHostTaken($domain)) {
                $results[] = ['input' => $domain, 'status' => 'duplicate', 'error' => 'domain_taken'];
                $failedCount++;
                continue;
            }

            do {
                $clientId = 'client_' . Str::lower(Str::random(12));
            } while (DB::table('authorized_clients')->where('client_id', $clientId)->exists());

            DB::table('authorized_clients')->insert([
                'client_id' => $clientId,
                'domain' => $domain,
                'owner_name' => $ownerName,
                'owner_phone' => $ownerPhone,
                'daily_limit' => $dailyLimit,
                'monthly_limit' => $monthlyLimit,
                'status' => 'active',
                'expires_at' => $expiresAt,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            $results[] = ['input' => $domain, 'status' => 'ok', 'client_id' => $clientId];
            $successCount++;
        }

        return response()->json([
            'success_count' => $successCount,
            'failed_count' => $failedCount,
            'results' => $results,
        ], 200);
    }

    /**
     * POST /admin/api/clients/batch-delete
     * Body: { client_ids: string[] }
     * 复用 destroy 的业务校验：存在正在打包的任务时该条不删，其它照常删。
     */
    public function batchDelete(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'client_ids' => ['required', 'array', 'min:1', 'max:200'],
            'client_ids.*' => ['required', 'string', 'max:32'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $results = [];
        $successCount = 0;
        $failedCount = 0;

        foreach ($request->input('client_ids') as $clientId) {
            $client = DB::table('authorized_clients')->where('client_id', $clientId)->first();
            if (!$client) {
                $results[] = ['client_id' => $clientId, 'status' => 'not_found'];
                $failedCount++;
                continue;
            }

            $active = DB::table('build_requests')
                ->where('client_id', $clientId)
                ->whereIn('status', ['pending', 'queued', 'building'])
                ->count();
            if ($active > 0) {
                $results[] = [
                    'client_id' => $clientId,
                    'domain' => $client->domain,
                    'status' => 'has_active_builds',
                    'active_count' => $active,
                ];
                $failedCount++;
                continue;
            }

            DB::transaction(function () use ($clientId) {
                DB::table('build_quotas')->where('client_id', $clientId)->delete();
                // 关联表无外键级联，需手动清理，避免遗留孤儿授权行
                DB::table('client_mall_authorizations')->where('client_id', $clientId)->delete();
                DB::table('authorized_clients')->where('client_id', $clientId)->delete();
            });

            $results[] = ['client_id' => $clientId, 'domain' => $client->domain, 'status' => 'ok'];
            $successCount++;
        }

        return response()->json([
            'success_count' => $successCount,
            'failed_count' => $failedCount,
            'results' => $results,
        ], 200);
    }

    /**
     * POST /admin/api/clients/batch-reset-quota
     * Body: { client_ids: string[], scope: 'today'|'month'|'all' }
     * 重置选中客户端的已用打包配额。
     */
    public function batchResetQuota(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'client_ids' => ['required', 'array', 'min:1', 'max:500'],
            'client_ids.*' => ['required', 'string', 'max:32'],
            'scope' => ['required', 'in:today,month,all'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $clientIds = $request->input('client_ids');
        $scope = $request->input('scope');

        $query = DB::table('build_quotas')->whereIn('client_id', $clientIds);

        if ($scope === 'today') {
            $query->where('date', now()->toDateString());
        } elseif ($scope === 'month') {
            $query->where('date', '>=', now()->startOfMonth()->toDateString());
        }
        // scope === 'all' 不加日期限制

        $deleted = $query->delete();

        return response()->json([
            'deleted_records' => $deleted,
            'client_count' => count($clientIds),
            'scope' => $scope,
        ], 200);
    }

    /**
     * POST /admin/api/clients/batch-update-status
     * Body: { client_ids: string[], status: 'active'|'suspended'|'expired' }
     */
    public function batchUpdateStatus(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'client_ids' => ['required', 'array', 'min:1', 'max:500'],
            'client_ids.*' => ['required', 'string', 'max:32'],
            'status' => ['required', 'in:active,suspended,expired'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $updatedCount = DB::table('authorized_clients')
            ->whereIn('client_id', $request->input('client_ids'))
            ->update([
                'status' => $request->input('status'),
                'updated_at' => now(),
            ]);

        return response()->json([
            'success_count' => $updatedCount,
            'target_status' => $request->input('status'),
        ], 200);
    }

    /**
     * POST /admin/api/clients/batch-update-limit
     * Body: { client_ids: string[], daily_limit?: int, monthly_limit?: int }
     * 至少传 daily_limit / monthly_limit 之一；只更新传入的字段，未传字段保持原值。
     */
    public function batchUpdateLimit(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'client_ids' => ['required', 'array', 'min:1', 'max:500'],
            'client_ids.*' => ['required', 'string', 'max:32'],
            'daily_limit' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:1000'],
            'monthly_limit' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:10000'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $hasDaily = $request->filled('daily_limit');
        $hasMonthly = $request->filled('monthly_limit');
        if (!$hasDaily && !$hasMonthly) {
            return response()->json(['error' => 'limit_required', 'message' => '至少指定 daily_limit 或 monthly_limit 之一'], 422);
        }

        $update = ['updated_at' => now()];
        if ($hasDaily) {
            $update['daily_limit'] = (int) $request->input('daily_limit');
        }
        if ($hasMonthly) {
            $update['monthly_limit'] = (int) $request->input('monthly_limit');
        }

        $updatedCount = DB::table('authorized_clients')
            ->whereIn('client_id', $request->input('client_ids'))
            ->update($update);

        return response()->json([
            'success_count' => $updatedCount,
            'daily_limit' => $hasDaily ? (int) $request->input('daily_limit') : null,
            'monthly_limit' => $hasMonthly ? (int) $request->input('monthly_limit') : null,
        ], 200);
    }

    /**
     * POST /admin/api/clients/{clientId}/set-reviewer
     * Body: { is_hub_reviewer: bool }
     * 任命 / 解任单个云控端为共享灵感库审核员。
     */
    public function setReviewer(Request $request, string $clientId): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'is_hub_reviewer' => ['required', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $client = DB::table('authorized_clients')->where('client_id', $clientId)->first(['client_id', 'is_hub_reviewer']);
        if (!$client) {
            return response()->json(['error' => 'client_not_found'], 404);
        }

        DB::table('authorized_clients')
            ->where('client_id', $clientId)
            ->update([
                'is_hub_reviewer' => $request->boolean('is_hub_reviewer'),
                'updated_at' => now(),
            ]);

        return response()->json([
            'ok' => true,
            'client_id' => $clientId,
            'is_hub_reviewer' => $request->boolean('is_hub_reviewer'),
        ]);
    }

    /**
     * POST /admin/api/clients/batch-set-reviewer
     * Body: { client_ids: string[], is_hub_reviewer: bool }
     * 批量任命 / 解任审核员。
     */
    public function batchSetReviewer(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'client_ids'       => ['required', 'array', 'min:1', 'max:500'],
            'client_ids.*'     => ['required', 'string', 'max:32'],
            'is_hub_reviewer'  => ['required', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $updatedCount = DB::table('authorized_clients')
            ->whereIn('client_id', $request->input('client_ids'))
            ->update([
                'is_hub_reviewer' => $request->boolean('is_hub_reviewer'),
                'updated_at' => now(),
            ]);

        return response()->json([
            'success_count'   => $updatedCount,
            'is_hub_reviewer' => $request->boolean('is_hub_reviewer'),
        ]);
    }

    /**
     * POST /admin/api/clients/{clientId}/set-maintenance-exempt
     * Body: { maintenance_exempt: bool }
     * 设置 / 取消单个云控端的「维护期可打包」豁免。开启后，即使平台全局打包维护
     * 已开启，该云控端仍可正常提交打包（用于指定客户端做生产测试）。
     */
    public function setMaintenanceExempt(Request $request, string $clientId): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'maintenance_exempt' => ['required', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $client = DB::table('authorized_clients')->where('client_id', $clientId)->first(['client_id', 'maintenance_exempt']);
        if (!$client) {
            return response()->json(['error' => 'client_not_found'], 404);
        }

        DB::table('authorized_clients')
            ->where('client_id', $clientId)
            ->update([
                'maintenance_exempt' => $request->boolean('maintenance_exempt'),
                'updated_at' => now(),
            ]);

        return response()->json([
            'ok' => true,
            'client_id' => $clientId,
            'maintenance_exempt' => $request->boolean('maintenance_exempt'),
        ]);
    }

    /**
     * POST /admin/api/clients/batch-set-maintenance-exempt
     * Body: { client_ids: string[], maintenance_exempt: bool }
     * 批量设置 / 取消「维护期可打包」豁免。
     */
    public function batchSetMaintenanceExempt(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'client_ids'         => ['required', 'array', 'min:1', 'max:500'],
            'client_ids.*'       => ['required', 'string', 'max:32'],
            'maintenance_exempt' => ['required', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $updatedCount = DB::table('authorized_clients')
            ->whereIn('client_id', $request->input('client_ids'))
            ->update([
                'maintenance_exempt' => $request->boolean('maintenance_exempt'),
                'updated_at' => now(),
            ]);

        return response()->json([
            'success_count'      => $updatedCount,
            'maintenance_exempt' => $request->boolean('maintenance_exempt'),
        ]);
    }

    /**
     * POST /admin/api/clients/{clientId}/set-ewei-shop
     * Body: { can_use_ewei_shop: bool }
     * 开放 / 关闭单个云控端的「店铺商品图」功能授权。授权后该云控端 auth-check 返回 true，
     * 其旗下用户方可在桌面端使用（再叠加云控端 per-user 权限二级门控）。
     */
    public function setEweiShop(Request $request, string $clientId): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'can_use_ewei_shop' => ['required', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $client = DB::table('authorized_clients')->where('client_id', $clientId)->first(['client_id', 'can_use_ewei_shop']);
        if (!$client) {
            return response()->json(['error' => 'client_not_found'], 404);
        }

        $authorized = $request->boolean('can_use_ewei_shop');
        // ewei 一级授权写入收口到 service：内部 upsert 关联表 ('ewei', authorized)
        // 并同步回写旧列 can_use_ewei_shop（双写），保证新旧授权源一致。
        $this->mallAuth->setAuthorization($clientId, 'ewei', $authorized);

        return response()->json([
            'ok' => true,
            'client_id' => $clientId,
            'can_use_ewei_shop' => $authorized,
        ]);
    }

    /**
     * POST /admin/api/clients/batch-set-ewei-shop
     * Body: { client_ids: string[], can_use_ewei_shop: bool }
     * 批量开放 / 关闭「店铺商品图」功能授权。
     */
    public function batchSetEweiShop(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'client_ids'        => ['required', 'array', 'min:1', 'max:500'],
            'client_ids.*'      => ['required', 'string', 'max:32'],
            'can_use_ewei_shop' => ['required', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $clientIds = $request->input('client_ids');
        $authorized = $request->boolean('can_use_ewei_shop');
        // success_count 仍按命中的存量 client 数统计（不依赖授权写入的副作用），保持返回结构不变。
        $updatedCount = DB::table('authorized_clients')
            ->whereIn('client_id', $clientIds)
            ->count();
        // ewei 一级授权写入收口到 service：每个 client 内部 upsert 关联表 + 回写旧列双写。
        foreach ($clientIds as $cid) {
            $this->mallAuth->setAuthorization($cid, 'ewei', $authorized);
        }

        return response()->json([
            'success_count'     => $updatedCount,
            'can_use_ewei_shop' => $authorized,
        ]);
    }

    /**
     * POST /admin/api/clients/{clientId}/set-mall-auth
     * Body: { mall_key: 'ewei'|'dianda'|'qdyun', authorized: bool }
     * 通用「按商城」一级授权：写入收口到 MallAuthorizationService::setAuthorization
     * （内部 upsert client_mall_authorizations；mall_key='ewei' 时同步回写旧列 can_use_ewei_shop）。
     */
    public function setMallAuth(Request $request, string $clientId): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'mall_key'   => ['required', 'string', 'in:' . implode(',', MallAuthorizationService::MALL_KEYS)],
            'authorized' => ['required', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $client = DB::table('authorized_clients')->where('client_id', $clientId)->first(['client_id']);
        if (!$client) {
            return response()->json(['error' => 'client_not_found'], 404);
        }

        $mallKey = (string) $request->input('mall_key');
        $authorized = $request->boolean('authorized');

        // upsert + ewei 旧列双写全在 service 内部一处完成。
        $this->mallAuth->setAuthorization($clientId, $mallKey, $authorized);

        return response()->json([
            'ok' => true,
            'client_id' => $clientId,
            'mall_key' => $mallKey,
            'authorized' => $authorized,
        ]);
    }

    /**
     * POST /admin/api/clients/batch-set-mall-auth
     * Body: { client_ids: string[], mall_key: 'ewei'|'dianda'|'qdyun', authorized: bool }
     * 批量「按商城」一级授权。写入收口到 service（ewei 同步回写旧列 can_use_ewei_shop）。
     */
    public function batchSetMallAuth(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'client_ids'   => ['required', 'array', 'min:1', 'max:500'],
            'client_ids.*' => ['required', 'string', 'max:32'],
            'mall_key'     => ['required', 'string', 'in:' . implode(',', MallAuthorizationService::MALL_KEYS)],
            'authorized'   => ['required', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $clientIds = $request->input('client_ids');
        $mallKey = (string) $request->input('mall_key');
        $authorized = $request->boolean('authorized');

        // upsert + ewei 旧列双写全在 service 内部一处完成。
        foreach ($clientIds as $cid) {
            $this->mallAuth->setAuthorization($cid, $mallKey, $authorized);
        }

        return response()->json([
            'success_count' => count($clientIds),
            'mall_key' => $mallKey,
            'authorized' => $authorized,
        ]);
    }

    /**
     * POST /admin/api/clients/{clientId}/set-packaging-auth
     * Body: { feature: 'win'|'mac', authorized: bool }
     */
    public function setPackagingAuth(Request $request, string $clientId): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'feature' => ['required', 'string', 'in:win,mac'],
            'authorized' => ['required', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $client = DB::table('authorized_clients')->where('client_id', $clientId)->first(['client_id']);
        if (!$client) {
            return response()->json(['error' => 'client_not_found'], 404);
        }

        $feature = (string) $request->input('feature');
        $authorized = $request->boolean('authorized');
        $column = $feature === 'mac' ? 'can_use_mac_packaging' : 'can_use_github_packaging';
        DB::table('authorized_clients')->where('client_id', $clientId)->update([
            $column => $authorized,
            'updated_at' => now(),
        ]);

        return response()->json([
            'ok' => true,
            'client_id' => $clientId,
            'feature' => $feature,
            'authorized' => $authorized,
        ]);
    }

    /**
     * POST /admin/api/clients/batch-set-packaging-auth
     * Body: { client_ids: string[], feature: 'win'|'mac', authorized: bool }
     */
    public function batchSetPackagingAuth(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'client_ids' => ['required', 'array', 'min:1', 'max:500'],
            'client_ids.*' => ['required', 'string', 'max:32'],
            'feature' => ['required', 'string', 'in:win,mac'],
            'authorized' => ['required', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $feature = (string) $request->input('feature');
        $authorized = $request->boolean('authorized');
        $column = $feature === 'mac' ? 'can_use_mac_packaging' : 'can_use_github_packaging';
        $clientIds = $request->input('client_ids');
        DB::table('authorized_clients')->whereIn('client_id', $clientIds)->update([
            $column => $authorized,
            'updated_at' => now(),
        ]);

        return response()->json([
            'success_count' => count($clientIds),
            'feature' => $feature,
            'authorized' => $authorized,
        ]);
    }
}
