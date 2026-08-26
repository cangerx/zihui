<?php

namespace App\Http\Controllers;

use App\Jobs\ProcessMattingTaskJob;
use App\Models\MattingTask;
use App\Models\SystemSetting;
use App\Services\BalanceService;
use App\Services\Aliyun\AliyunMattingService;
use App\Services\Matting\MattingRateLimiter;
use App\Services\QuotaService;
use App\Services\RateLimitService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Throwable;

/**
 * AI 抠图（阿里 viapi - SegmentHDCommonImage）的网关 / 管理控制器。
 *
 * v1.5.0 重构：凭证 / 计费 / 启用开关统一走 SystemSetting (matting_*)，不再走 cloud_providers / cloud_models /
 * billing_rules / usage_records 体系。matting_tasks 表自治计量。
 *
 * 协议复用 ImageTask 异步任务模式：客户端 POST /segment 拿 task_id，再轮询 /status/{id}。
 *   - QUEUE_CONNECTION=sync（默认）→ Controller 用 terminating callback 包 Job::handle()
 *   - QUEUE_CONNECTION=database → ::dispatch() 入队
 *
 * 用户端 4 个端点：
 *   - POST   /gateway/matting/segment        提交（multipart file 或 image_url 参数）
 *   - GET    /gateway/matting/status/{id}    轮询
 *   - GET    /gateway/matting/quota          本月配额状态
 *   - GET    /gateway/matting/tasks          自己的历史任务（轻量列表）
 *
 * 管理端 7 个端点（admin 中间件）：
 *   - GET    /admin/matting/tasks            全站任务列表（分页 + 过滤）
 *   - GET    /admin/matting/tasks/{id}       任务详情
 *   - DELETE /admin/matting/tasks/{id}       删除（含 batch-delete）
 *   - GET    /admin/matting/stats            用量统计 + 实时限流压力 + 配置状态
 *   - POST   /admin/matting/test             管理员测试：上传一张图直接跑通端到端
 *   - GET    /admin/matting/settings         读当前 AK/SK（密文隐藏） + endpoint/region/credit/enabled
 *   - PUT    /admin/matting/settings         保存上诶 6 项（AK Secret 留空 = 不修改）
 */
class MattingController extends Controller
{
    /** 必填设置添加后，抠图才能走通；getMattingSettings() 报错时返回的。 */
    private const SETTING_KEYS = [
        'matting_enabled',
        'matting_access_key_id',
        'matting_access_key_secret',
        'matting_endpoint',
        'matting_region_id',
        'matting_credit_per_call',
    ];

    // ========== Client ==========

    public function segment(Request $request)
    {
        $user = auth()->user();

        // ---------- 1. 服务总开关校验（matting_enabled）----------
        if (!SystemSetting::getValue('matting_enabled', false)) {
            return response()->json(['error' => '抠图服务未启用，请联系管理员'], 503);
        }

        // ---------- 2. 用户权限校验 ----------
        $perms = app(QuotaService::class)->policies($user);
        if (!($perms['allow_image_matting'] ?? true)) {
            return response()->json(['error' => '当前账号未开通 AI 抠图功能'], 403);
        }

        try {
            app(QuotaService::class)->assertAvailableForType($user, 'matting', 1);
            $rateLimit = app(RateLimitService::class);
            $rateLimit->assertAllowed($user, 'matting', $rateLimit->effectiveLimits($user, 'matting', $perms));
        } catch (Throwable $e) {
            // 区分「配额用尽」与「限流繁忙」，配额超限给中文友好文案（含已用/上限）
            if (str_contains($e->getMessage(), 'Quota exceeded')) {
                $st = app(QuotaService::class)->check($user, 'matting_quota_per_month', 1);
                return response()->json([
                    'error' => "本月抠图配额已用完（已用 {$st['used']} / 上限 {$st['limit']}），请下月再试或联系管理员",
                ], 429);
            }
            return response()->json(['error' => '抠图请求过于频繁，请稍后重试'], 429);
        }

        // ---------- 4. 余额校验（从 SystemSetting 读 credit_per_call）----------
        $needed = $this->mattingCreditPerCall($perms);
        if ($needed > 0) {
            $balance = app(BalanceService::class)->totalBalance($user->id, 'credit');
            if ($balance < $needed) {
                return response()->json([
                    'error'   => '积分余额不足，本次需 ' . round($needed, 4) . '，当前 ' . round($balance, 4) . '，请充值后重试',
                    'needed'  => $needed,
                    'current' => $balance,
                ], 402);
            }
        }

        // ---------- 5. 输入解析（上传 vs URL）----------
        $source = $request->hasFile('image') ? 'upload' : 'url';
        $taskId = (string) Str::uuid();
        $requestId = (string) Str::uuid();
        $tempPath = '';
        $requestMeta = [];

        if ($source === 'upload') {
            $file = $request->file('image');
            if (!$file || !$file->isValid()) {
                return response()->json(['error' => '文件上传失败'], 400);
            }
            // 校验扩展名 + 大小
            $matCfg = config('aliyun.matting');
            $ext = strtolower($file->getClientOriginalExtension() ?: $file->extension());
            $allowed = $matCfg['allowed_extensions'];
            if (!in_array($ext, $allowed, true)) {
                return response()->json([
                    'error' => '不支持的格式 .' . $ext . '（仅支持 ' . implode('/', $allowed) . '）',
                ], 415);
            }
            $size = $file->getSize();
            if ($size === false || $size <= 0) {
                return response()->json(['error' => '文件为空'], 400);
            }
            $maxSize = (int) $matCfg['max_file_size_bytes'];
            if ($size > $maxSize) {
                return response()->json([
                    'error' => '文件超过 ' . round($maxSize / 1024 / 1024, 1) . 'MB 限制',
                ], 413);
            }

            $tempPath = storage_path("app/tmp/matting/{$taskId}.{$ext}");
            if (!is_dir(dirname($tempPath))) {
                @mkdir(dirname($tempPath), 0775, true);
            }
            $file->move(dirname($tempPath), basename($tempPath));

            $requestMeta = [
                'filename'        => $file->getClientOriginalName(),
                'file_extension'  => $ext,
                'file_size'       => $size,
            ];
        } else {
            $v = Validator::make($request->all(), [
                'image_url' => 'required|url|max:1000',
            ]);
            if ($v->fails()) {
                return response()->json(['error' => $v->errors()->first()], 422);
            }
            $url = (string) $request->input('image_url');
            Cache::put("matting:task:{$taskId}:url", $url, now()->addMinutes(30));
            $requestMeta = ['image_url' => $url];
        }

        // ---------- 6. 限流（双层）----------
        $rl = app(MattingRateLimiter::class);
        $token = $rl->tryAcquire((int) $user->id);
        if (!$token) {
            if ($tempPath && is_file($tempPath)) @unlink($tempPath);
            Cache::forget("matting:task:{$taskId}:url");
            $stats = $rl->stats((int) $user->id);
            return response()->json([
                'error' => '抠图服务繁忙，请稍后重试',
                'stats' => $stats,
            ], 429);
        }

        // ---------- 7. 入库 + 派发 Job ----------
        MattingTask::create([
            'id'             => $taskId,
            'user_id'        => $user->id,
            'source'         => $source,
            'request_meta'   => $requestMeta,
            'status'         => 'pending',
            'cost'           => $needed,
            'request_id'     => $requestId,
        ]);

        if (config('queue.default', 'sync') === 'sync') {
            // PHP-FPM 同步路径：响应后用 terminating 包同步跑 Job
            app()->terminating(function () use ($taskId, $token, $tempPath) {
                @set_time_limit(0);
                try {
                    app()->call([
                        new ProcessMattingTaskJob($taskId, $token, $tempPath),
                        'handle',
                    ]);
                } catch (Throwable $e) {
                    Log::error("[MattingController.terminating] {$taskId}: {$e->getMessage()}");
                    MattingTask::where('id', $taskId)
                        ->whereNotIn('status', ['completed', 'failed'])
                        ->update(['status' => 'failed', 'error' => 'Job exception: ' . $e->getMessage()]);
                }
            });
        } else {
            ProcessMattingTaskJob::dispatch($taskId, $token, $tempPath);
        }

        return response()->json([
            'task_id' => $taskId,
            'status'  => 'pending',
        ]);
    }

    public function status(Request $request, string $taskId)
    {
        $user = auth()->user();
        $task = MattingTask::where('id', $taskId)->where('user_id', $user->id)->first();
        if (!$task) {
            return response()->json(['error' => 'Task not found'], 404);
        }

        $resp = [
            'task_id' => $task->id,
            'status'  => $task->status,
        ];
        if ($task->status === 'completed') {
            $resp['result'] = $task->result;
        } elseif ($task->status === 'failed') {
            $resp['error'] = $task->error;
        }
        return response()->json($resp);
    }

    public function myQuota()
    {
        $user = auth()->user();
        $perms = app(QuotaService::class)->policies($user);

        $enabled = (bool) SystemSetting::getValue('matting_enabled', false);
        $credit = $this->mattingCreditPerCall($perms);
        $quotaStatus = app(QuotaService::class)->check($user, 'matting_quota_per_month', 1);

        return response()->json([
            'matting_enabled'               => $enabled,
            'allow_image_matting'           => $enabled && (bool) ($perms['allow_image_matting'] ?? true),
            'allow_custom_matting_provider' => (bool) ($perms['allow_custom_matting_provider'] ?? false),
            'image_matting_quota_per_month' => (int) ($perms['image_matting_quota_per_month'] ?? 100),
            'used_this_month'               => (int)$quotaStatus['used'],
            'quota_status'                  => $quotaStatus,
            'credit_per_call'               => $credit,
            'current_credit_balance'        => app(BalanceService::class)->totalBalance($user->id, 'credit'),
        ]);
    }

    public function myTasks(Request $request)
    {
        $user = auth()->user();
        $tasks = MattingTask::where('user_id', $user->id)
            ->orderByDesc('created_at')
            ->paginate((int) $request->get('per_page', 20));
        return response()->json($tasks);
    }

    // ========== Admin ==========

    public function adminIndex(Request $request)
    {
        $q = MattingTask::query()->with(['user:id,username,nickname']);

        if ($request->filled('user_id')) {
            $q->where('user_id', (int) $request->user_id);
        }
        if ($request->filled('status')) {
            $q->where('status', $request->status);
        }
        if ($request->filled('source')) {
            $q->where('source', $request->source);
        }
        if ($request->filled('keyword')) {
            $kw = '%' . $request->keyword . '%';
            $q->where(function ($w) use ($kw) {
                $w->where('id', 'like', $kw)
                  ->orWhere('request_id', 'like', $kw)
                  ->orWhere('error', 'like', $kw);
            });
        }
        if ($request->filled('from_date')) {
            $q->where('created_at', '>=', $request->from_date);
        }
        if ($request->filled('to_date')) {
            $q->where('created_at', '<=', $request->to_date);
        }

        $rows = $q->orderByDesc('created_at')
            ->paginate((int) $request->get('per_page', 50));
        return response()->json($rows);
    }

    public function adminShow(string $taskId)
    {
        $task = MattingTask::with('user:id,username,nickname')->find($taskId);
        if (!$task) return response()->json(['error' => 'Task not found'], 404);
        return response()->json($task);
    }

    public function adminDestroy(string $taskId)
    {
        $task = MattingTask::find($taskId);
        if ($task) $task->delete();
        return response()->json(['ok' => true]);
    }

    public function adminBatchDestroy(Request $request)
    {
        $ids = (array) $request->input('ids', []);
        if (empty($ids)) return response()->json(['error' => 'ids is required'], 400);
        $deleted = MattingTask::whereIn('id', $ids)->delete();
        return response()->json(['ok' => true, 'deleted' => $deleted]);
    }

    public function adminStats(Request $request)
    {
        $monthStart = now()->startOfMonth();
        $todayStart = now()->startOfDay();

        $byStatus = MattingTask::select('status', DB::raw('COUNT(*) as cnt'))
            ->groupBy('status')->pluck('cnt', 'status');

        $todayTotal = MattingTask::where('created_at', '>=', $todayStart)->count();
        $todaySuccess = MattingTask::where('created_at', '>=', $todayStart)
            ->where('status', 'completed')->count();
        $monthTotal = MattingTask::where('created_at', '>=', $monthStart)->count();
        $monthSuccess = MattingTask::where('created_at', '>=', $monthStart)
            ->where('status', 'completed')->count();

        // 本月总扣费（全站）——直接从 matting_tasks.cost 汇总（任务表自治计量，不再复用 usage_records）
        $monthCost = (float) MattingTask::where('status', 'completed')
            ->where('created_at', '>=', $monthStart)
            ->sum('cost');

        // Top 10 用户（本月成功任务数 + 扣费总额）
        $topUsers = MattingTask::where('created_at', '>=', $monthStart)
            ->select('user_id',
                DB::raw('SUM(CASE WHEN status="completed" THEN 1 ELSE 0 END) as success_count'),
                DB::raw('SUM(CASE WHEN status="completed" THEN cost ELSE 0 END) as credits'))
            ->groupBy('user_id')
            ->orderByDesc('success_count')
            ->limit(10)
            ->with('user:id,username,nickname')
            ->get();

        // 配置状态（从 SystemSetting 读，AK ID 脱敏 masked + AK Secret 只返回 "是否已配置"，不返回明文）
        $ak = (string) SystemSetting::getValue('matting_access_key_id', '');
        $hasSecret = !empty(SystemSetting::getRawValue('matting_access_key_secret', ''));
        $config = [
            'enabled'                => (bool) SystemSetting::getValue('matting_enabled', false),
            'access_key_id_masked'   => $this->maskAk($ak),
            'access_key_configured'  => !empty($ak) && $hasSecret,
            'endpoint'               => (string) SystemSetting::getValue('matting_endpoint', 'imageseg.cn-shanghai.aliyuncs.com'),
            'region_id'              => (string) SystemSetting::getValue('matting_region_id', 'cn-shanghai'),
            'credit_per_call'        => (float) SystemSetting::getValue('matting_credit_per_call', 0.2),
            'global_qps'             => config('aliyun.matting.global_qps'),
            'per_user_concurrency'   => config('aliyun.matting.per_user_concurrency'),
            'poll_timeout_seconds'   => config('aliyun.matting.poll_timeout_seconds'),
            'max_file_size_mb'       => round(config('aliyun.matting.max_file_size_bytes') / 1024 / 1024, 1),
        ];

        return response()->json([
            'today'  => ['total' => $todayTotal, 'success' => $todaySuccess],
            'month'  => ['total' => $monthTotal, 'success' => $monthSuccess, 'credits' => $monthCost],
            'by_status' => $byStatus,
            'top_users' => $topUsers,
            'config' => $config,
        ]);
    }

    /**
     * 读当前抠图设置（admin）。Secret 只返 has_xxx 标志位，不返明文。
     */
    public function adminGetSettings()
    {
        $ak = (string) SystemSetting::getValue('matting_access_key_id', '');
        $hasSecret = !empty(SystemSetting::getRawValue('matting_access_key_secret', ''));
        return response()->json([
            'matting_enabled'             => (bool) SystemSetting::getValue('matting_enabled', false),
            'matting_access_key_id'       => $ak,
            'matting_access_key_id_masked' => $this->maskAk($ak),
            'has_matting_access_key_secret' => $hasSecret,
            'matting_endpoint'            => (string) SystemSetting::getValue('matting_endpoint', 'imageseg.cn-shanghai.aliyuncs.com'),
            'matting_region_id'           => (string) SystemSetting::getValue('matting_region_id', 'cn-shanghai'),
            'matting_credit_per_call'     => (float) SystemSetting::getValue('matting_credit_per_call', 0.2),
            // endpoint 下拉选项，默认填充（用户决策 #2）
            'endpoint_options'  => [
                ['value' => 'imageseg.cn-shanghai.aliyuncs.com', 'label' => 'cn-shanghai（推荐）', 'region_id' => 'cn-shanghai'],
                ['value' => 'imageseg.cn-beijing.aliyuncs.com',  'label' => 'cn-beijing',           'region_id' => 'cn-beijing'],
            ],
        ]);
    }

    /**
     * 保存抠图设置（admin）。Secret 留空 = 不修改（与 SettingController 一致的徽变字段语义）。
     */
    public function adminUpdateSettings(Request $request)
    {
        $v = Validator::make($request->all(), [
            'matting_enabled'           => 'sometimes|boolean',
            'matting_access_key_id'     => 'sometimes|string|max:200',
            'matting_access_key_secret' => 'sometimes|nullable|string|max:500',
            'matting_endpoint'          => 'sometimes|string|max:200',
            'matting_region_id'         => 'sometimes|string|max:50',
            'matting_credit_per_call'   => 'sometimes|nullable|numeric|min:0',
        ]);
        if ($v->fails()) {
            return response()->json(['error' => $v->errors()->first()], 422);
        }

        foreach (self::SETTING_KEYS as $key) {
            if (!$request->has($key)) continue;
            $val = $request->input($key);
            // Secret 留空 / null 表示保持原值，不覆盖为空
            if ($key === 'matting_access_key_secret' && ($val === '' || $val === null)) {
                continue;
            }
            if ($key === 'matting_credit_per_call' && ($val === '' || $val === null)) {
                $val = 0;
            }
            SystemSetting::setValue($key, $val);
        }
        return $this->adminGetSettings();
    }

    public function adminTest(Request $request, AliyunMattingService $svc)
    {
        $v = Validator::make($request->all(), [
            'image' => 'required|file',
        ]);
        if ($v->fails()) return response()->json(['error' => $v->errors()->first()], 422);

        // 测试调用不看 matting_enabled 总开关（该端点本身就是调试工具），但必须事先填了 AK
        try {
            $svc->configure($this->resolveCreds());
        } catch (Throwable $e) {
            return response()->json(['ok' => false, 'error' => $e->getMessage()], 400);
        }

        $file = $request->file('image');
        $ext  = strtolower($file->getClientOriginalExtension() ?: $file->extension());
        $temp = storage_path("app/tmp/matting/admin-test-" . Str::uuid() . ".{$ext}");
        if (!is_dir(dirname($temp))) @mkdir(dirname($temp), 0775, true);
        $file->move(dirname($temp), basename($temp));

        try {
            $result = $svc->segmentLocalFile($temp);
            @unlink($temp);
            return response()->json(['ok' => true, 'result' => $result]);
        } catch (Throwable $e) {
            @unlink($temp);
            return response()->json([
                'ok'    => false,
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * 从 SystemSetting 读凭证汇总（供 Service 注入 / Job 使用）。Secret 走 getRawValue 拿明文。
     * 使用后不要返回给 API 响应。
     *
     * @return array{access_key_id:string,access_key_secret:string,endpoint:string,region_id:string}
     */
    public static function resolveCreds(): array
    {
        return [
            'access_key_id'     => (string) SystemSetting::getRawValue('matting_access_key_id', ''),
            'access_key_secret' => (string) SystemSetting::getRawValue('matting_access_key_secret', ''),
            'endpoint'          => (string) SystemSetting::getValue('matting_endpoint', 'imageseg.cn-shanghai.aliyuncs.com'),
            'region_id'         => (string) SystemSetting::getValue('matting_region_id', 'cn-shanghai'),
        ];
    }

    private function maskAk(string $ak): string
    {
        if ($ak === '') return '';
        if (strlen($ak) <= 8) return '****';
        return substr($ak, 0, 4) . '****' . substr($ak, -4);
    }

    // ===== Helpers =====

    /**
     * 解析当前用户的所有 policy（user-self > plan > group > default）。
     * 复用 ClientController::myPermissions 的合并逻辑，但裁剪到只取 matting 相关 key。
     */
    private function resolveUserPolicies(int $userId): array
    {
        $user = \App\Models\User::find($userId);
        return $user ? app(QuotaService::class)->policies($user) : [];
    }

    private function mattingCreditPerCall(array $perms): float
    {
        if (isset($perms['matting_credit_per_call']) && is_numeric($perms['matting_credit_per_call'])) {
            return max(0, (float)$perms['matting_credit_per_call']);
        }
        if (isset($perms['image_matting_credit_per_call']) && is_numeric($perms['image_matting_credit_per_call'])) {
            return max(0, (float)$perms['image_matting_credit_per_call']);
        }
        return (float) SystemSetting::getValue('matting_credit_per_call', 0.2);
    }

    private function countMonthUsage(int $userId): int
    {
        // 从 matting_tasks 自治统计本月成功任务数（v1.5.0+ 不再走 usage_records）
        return MattingTask::where('user_id', $userId)
            ->where('status', 'completed')
            ->where('created_at', '>=', now()->startOfMonth())
            ->count();
    }
}
