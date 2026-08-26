<?php

namespace App\Http\Controllers;

use App\Jobs\ProcessFineMattingTaskJob;
use App\Models\FineMattingTask;
use App\Models\SystemSetting;
use App\Services\BalanceService;
use App\Services\FineMatting\FineMattingConcurrencyLimiter;
use App\Services\Koukoutu\KoukoutuMattingService;
use App\Services\QuotaService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Throwable;

/**
 * 精细抠图（抠抠图 koukoutu 异步 API）网关 / 管理控制器。
 *
 * 与 AI 抠图（MattingController）平行的独立体系：
 *   - 凭证 / 三档计费 / 启用开关统一走 SystemSetting (fine_matting_*)。
 *   - fine_matting_tasks 表自治计量；配额走 QuotaService 'fine_matting' 类型。
 *   - 仅云端中转模式（API Key 只存服务端），并发由 FineMattingConcurrencyLimiter 控（全站 5）。
 *   - 仅 Image File 模式（multipart 上传），按上传图长边三档积分计费。
 *
 * 协议复用异步任务模式：客户端 POST /segment 拿 task_id，再轮询 /status/{id}。
 *   - QUEUE_CONNECTION=sync（默认）→ terminating callback 同步跑 Job::handle()
 *   - QUEUE_CONNECTION=database → ::dispatch() 入队
 *
 * 用户端 4 个端点：
 *   - POST /gateway/fine-matting/segment      提交（multipart file）
 *   - GET  /gateway/fine-matting/status/{id}  轮询
 *   - GET  /gateway/fine-matting/quota        本月配额 + 三档价 + 阈值（供桌面端预估）
 *   - GET  /gateway/fine-matting/tasks        自己的历史任务
 *
 * 管理端 8 个端点（admin 中间件）：
 *   - GET    /admin/fine-matting/stats             统计 + 三档分布 + 实时并发压力 + 配置状态
 *   - GET    /admin/fine-matting/settings          读设置（API Key 密文隐藏）
 *   - PUT    /admin/fine-matting/settings          保存设置（API Key 留空 = 不修改）
 *   - GET    /admin/fine-matting/tasks             全站任务列表
 *   - POST   /admin/fine-matting/tasks/batch-delete 批量删除
 *   - GET    /admin/fine-matting/tasks/{id}        任务详情
 *   - DELETE /admin/fine-matting/tasks/{id}        删除
 *   - POST   /admin/fine-matting/test             管理员测试：上传一张图直接跑通端到端
 */
class FineMattingController extends Controller
{
    private const SETTING_KEYS = [
        'fine_matting_enabled',
        'fine_matting_api_key',
        'fine_matting_tier1_credit',
        'fine_matting_tier2_credit',
        'fine_matting_tier3_credit',
        'fine_matting_tier_threshold_1',
        'fine_matting_tier_threshold_2',
    ];

    // ========== Client ==========

    public function segment(Request $request)
    {
        $user = auth()->user();

        // ---------- 1. 服务总开关 ----------
        if (!SystemSetting::getValue('fine_matting_enabled', false)) {
            return response()->json(['error' => '精细抠图服务未启用，请联系管理员'], 503);
        }
        // API Key 未配置时直接拒绝，避免占用并发槽后才在 Job 里 configure 失败
        if (trim(self::resolveCreds()) === '') {
            return response()->json(['error' => '精细抠图服务未配置 API Key，请联系管理员'], 503);
        }

        // ---------- 2. 用户权限 ----------
        $perms = app(QuotaService::class)->policies($user);
        if (!($perms['allow_fine_matting'] ?? true)) {
            return response()->json(['error' => '当前账号未开通精细抠图功能'], 403);
        }

        // ---------- 3. 配额预检（不扣）----------
        try {
            app(QuotaService::class)->assertAvailableForType($user, 'fine_matting', 1);
        } catch (Throwable $e) {
            // 区分「配额用尽」与「限流繁忙」，配额超限给中文友好文案（含已用/上限）
            if (str_contains($e->getMessage(), 'Quota exceeded')) {
                $st = app(QuotaService::class)->check($user, 'fine_matting_quota_per_month', 1);
                return response()->json([
                    'error' => "本月精细抠图配额已用完（已用 {$st['used']} / 上限 {$st['limit']}），请下月再试或联系管理员",
                ], 429);
            }
            return response()->json(['error' => '精细抠图请求过于频繁，请稍后重试'], 429);
        }

        // ---------- 4. 输入解析（仅 Image File 模式）----------
        if (!$request->hasFile('image')) {
            return response()->json(['error' => '请上传图片文件（image 字段）'], 400);
        }
        $file = $request->file('image');
        if (!$file || !$file->isValid()) {
            return response()->json(['error' => '文件上传失败'], 400);
        }

        $cfg = config('koukoutu.fine_matting');
        $ext = strtolower($file->getClientOriginalExtension() ?: $file->extension());
        $allowed = $cfg['allowed_extensions'];
        if (!in_array($ext, $allowed, true)) {
            return response()->json([
                'error' => '不支持的格式 .' . $ext . '（仅支持 ' . implode('/', $allowed) . '）',
            ], 415);
        }
        $size = $file->getSize();
        if ($size === false || $size <= 0) {
            return response()->json(['error' => '文件为空'], 400);
        }
        $maxSize = (int) $cfg['max_file_size_bytes'];
        if ($size > $maxSize) {
            return response()->json([
                'error' => '文件超过 ' . round($maxSize / 1024 / 1024, 1) . 'MB 限制',
            ], 413);
        }

        $taskId = (string) Str::uuid();
        $requestId = (string) Str::uuid();
        $tempPath = storage_path("app/tmp/fine-matting/{$taskId}.{$ext}");
        if (!is_dir(dirname($tempPath))) {
            @mkdir(dirname($tempPath), 0775, true);
        }
        $file->move(dirname($tempPath), basename($tempPath));

        // ---------- 5. 探测尺寸 + 三档定价 ----------
        [$width, $height] = $this->probeImageSize($tempPath);
        $maxSide = max($width, $height);

        // 分辨率上限校验（抠抠图限制 10000px）；探测失败（maxSide=0）不拦截，按档1兜底计费
        $maxResolution = (int) ($cfg['max_resolution'] ?? 10000);
        if ($maxSide > $maxResolution) {
            @unlink($tempPath);
            return response()->json([
                'error' => "图片分辨率超过 {$maxResolution}px 限制（当前长边 {$maxSide}px）",
            ], 413);
        }

        $tier = self::resolveTier($maxSide);
        $needed = self::tierCredit($tier);

        $requestMeta = [
            'filename'       => $file->getClientOriginalName(),
            'file_extension' => $ext,
            'file_size'      => $size,
            'width'          => $width,
            'height'         => $height,
        ];

        // ---------- 6. 余额预检 ----------
        if ($needed > 0) {
            $balance = app(BalanceService::class)->totalBalance($user->id, 'credit');
            if ($balance < $needed) {
                @unlink($tempPath);
                return response()->json([
                    'error'   => '积分余额不足，本次需 ' . round($needed, 4) . '，当前 ' . round($balance, 4) . '，请充值后重试',
                    'needed'  => $needed,
                    'current' => $balance,
                ], 402);
            }
        }

        // ---------- 7. 并发信号量（全站 5 + 单用户）----------
        $rl = app(FineMattingConcurrencyLimiter::class);
        $token = $rl->tryAcquire((int) $user->id);
        if (!$token) {
            @unlink($tempPath);
            return response()->json([
                'error' => '精细抠图服务繁忙，请稍后重试',
                'stats' => $rl->stats((int) $user->id),
            ], 429);
        }

        // ---------- 8. 入库 + 派发 Job ----------
        FineMattingTask::create([
            'id'           => $taskId,
            'user_id'      => $user->id,
            'source'       => 'upload',
            'request_meta' => $requestMeta,
            'status'       => 'pending',
            'width'        => $width,
            'height'       => $height,
            'tier'         => $tier,
            'cost'         => $needed,
            'request_id'   => $requestId,
        ]);

        if (config('queue.default', 'sync') === 'sync') {
            app()->terminating(function () use ($taskId, $token, $tempPath) {
                @set_time_limit(0);
                try {
                    app()->call([
                        new ProcessFineMattingTaskJob($taskId, $token, $tempPath),
                        'handle',
                    ]);
                } catch (Throwable $e) {
                    Log::error("[FineMattingController.terminating] {$taskId}: {$e->getMessage()}");
                    FineMattingTask::where('id', $taskId)
                        ->whereNotIn('status', ['completed', 'failed'])
                        ->update(['status' => 'failed', 'error' => 'Job exception: ' . $e->getMessage()]);
                    // 兜底释放并发槽 + 清临时文件（正常路径 Job::cleanup 已处理，这里防 handle cleanup 前的非预期异常）
                    Cache::forget($token);
                    if ($tempPath && is_file($tempPath)) @unlink($tempPath);
                }
            });
        } else {
            ProcessFineMattingTaskJob::dispatch($taskId, $token, $tempPath);
        }

        return response()->json([
            'task_id' => $taskId,
            'status'  => 'pending',
            'tier'    => $tier,
            'cost'    => $needed,
        ]);
    }

    public function status(Request $request, string $taskId)
    {
        $user = auth()->user();
        $task = FineMattingTask::where('id', $taskId)->where('user_id', $user->id)->first();
        if (!$task) {
            return response()->json(['error' => 'Task not found'], 404);
        }

        $resp = [
            'task_id' => $task->id,
            'status'  => $task->status,
            'tier'    => (int) $task->tier,
            'cost'    => (float) $task->cost,
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

        $enabled = (bool) SystemSetting::getValue('fine_matting_enabled', false);
        [$t1, $t2] = self::tierThresholds();
        $quotaStatus = app(QuotaService::class)->check($user, 'fine_matting_quota_per_month', 1);

        return response()->json([
            'fine_matting_enabled'         => $enabled,
            'allow_fine_matting'           => $enabled && (bool) ($perms['allow_fine_matting'] ?? true),
            'fine_matting_quota_per_month' => (int) ($perms['fine_matting_quota_per_month'] ?? 100),
            'used_this_month'              => (int) $quotaStatus['used'],
            'quota_status'                 => $quotaStatus,
            // 三档单价（本系统积分）+ 长边阈值，供桌面端按图预估
            'tier1_credit'                 => self::tierCredit(1),
            'tier2_credit'                 => self::tierCredit(2),
            'tier3_credit'                 => self::tierCredit(3),
            'tier_threshold_1'             => $t1,
            'tier_threshold_2'             => $t2,
            'current_credit_balance'       => app(BalanceService::class)->totalBalance($user->id, 'credit'),
            'max_file_size_mb'             => round((int) config('koukoutu.fine_matting.max_file_size_bytes') / 1024 / 1024, 1),
            'allowed_extensions'           => config('koukoutu.fine_matting.allowed_extensions'),
        ]);
    }

    public function myTasks(Request $request)
    {
        $user = auth()->user();
        $tasks = FineMattingTask::where('user_id', $user->id)
            ->orderByDesc('created_at')
            ->paginate((int) $request->get('per_page', 20));
        return response()->json($tasks);
    }

    // ========== Admin ==========

    public function adminIndex(Request $request)
    {
        $q = FineMattingTask::query()->with(['user:id,username,nickname']);

        if ($request->filled('user_id')) {
            $q->where('user_id', (int) $request->user_id);
        }
        if ($request->filled('status')) {
            $q->where('status', $request->status);
        }
        if ($request->filled('tier')) {
            $q->where('tier', (int) $request->tier);
        }
        if ($request->filled('keyword')) {
            $kw = '%' . $request->keyword . '%';
            $q->where(function ($w) use ($kw) {
                $w->where('id', 'like', $kw)
                  ->orWhere('request_id', 'like', $kw)
                  ->orWhere('provider_task_id', 'like', $kw)
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
        $task = FineMattingTask::with('user:id,username,nickname')->find($taskId);
        if (!$task) return response()->json(['error' => 'Task not found'], 404);
        return response()->json($task);
    }

    public function adminDestroy(string $taskId)
    {
        $task = FineMattingTask::find($taskId);
        if ($task) $task->delete();
        return response()->json(['ok' => true]);
    }

    public function adminBatchDestroy(Request $request)
    {
        $ids = (array) $request->input('ids', []);
        if (empty($ids)) return response()->json(['error' => 'ids is required'], 400);
        $deleted = FineMattingTask::whereIn('id', $ids)->delete();
        return response()->json(['ok' => true, 'deleted' => $deleted]);
    }

    public function adminStats(Request $request)
    {
        $monthStart = now()->startOfMonth();
        $todayStart = now()->startOfDay();

        $byStatus = FineMattingTask::select('status', DB::raw('COUNT(*) as cnt'))
            ->groupBy('status')->pluck('cnt', 'status');

        $todayTotal = FineMattingTask::where('created_at', '>=', $todayStart)->count();
        $todaySuccess = FineMattingTask::where('created_at', '>=', $todayStart)
            ->where('status', 'completed')->count();
        $monthTotal = FineMattingTask::where('created_at', '>=', $monthStart)->count();
        $monthSuccess = FineMattingTask::where('created_at', '>=', $monthStart)
            ->where('status', 'completed')->count();

        $monthCost = (float) FineMattingTask::where('status', 'completed')
            ->where('created_at', '>=', $monthStart)
            ->sum('cost');

        // 三档分布（本月成功任务）
        $byTier = FineMattingTask::where('status', 'completed')
            ->where('created_at', '>=', $monthStart)
            ->select('tier', DB::raw('COUNT(*) as cnt'), DB::raw('SUM(cost) as credits'))
            ->groupBy('tier')
            ->get()
            ->map(fn($r) => [
                'tier'    => (int) $r->tier,
                'count'   => (int) $r->cnt,
                'credits' => (float) $r->credits,
            ]);

        $topUsers = FineMattingTask::where('created_at', '>=', $monthStart)
            ->select('user_id',
                DB::raw('SUM(CASE WHEN status="completed" THEN 1 ELSE 0 END) as success_count'),
                DB::raw('SUM(CASE WHEN status="completed" THEN cost ELSE 0 END) as credits'))
            ->groupBy('user_id')
            ->orderByDesc('success_count')
            ->limit(10)
            ->with('user:id,username,nickname')
            ->get();

        [$t1, $t2] = self::tierThresholds();
        $hasKey = !empty(SystemSetting::getRawValue('fine_matting_api_key', ''));
        $config = [
            'enabled'                => (bool) SystemSetting::getValue('fine_matting_enabled', false),
            'api_key_configured'     => $hasKey,
            'tier1_credit'           => self::tierCredit(1),
            'tier2_credit'           => self::tierCredit(2),
            'tier3_credit'           => self::tierCredit(3),
            'tier_threshold_1'       => $t1,
            'tier_threshold_2'       => $t2,
            'global_concurrency'     => (int) config('koukoutu.fine_matting.global_concurrency'),
            'per_user_concurrency'   => (int) config('koukoutu.fine_matting.per_user_concurrency'),
            'poll_timeout_seconds'   => (int) config('koukoutu.fine_matting.poll_timeout_seconds'),
            'max_file_size_mb'       => round((int) config('koukoutu.fine_matting.max_file_size_bytes') / 1024 / 1024, 1),
        ];

        // 当前实时全站并发占用（用任一在线用户视角取 global_used 即可）
        $concurrency = app(FineMattingConcurrencyLimiter::class)->stats((int) (auth()->id() ?? 0));

        return response()->json([
            'today'       => ['total' => $todayTotal, 'success' => $todaySuccess],
            'month'       => ['total' => $monthTotal, 'success' => $monthSuccess, 'credits' => $monthCost],
            'by_status'   => $byStatus,
            'by_tier'     => $byTier,
            'top_users'   => $topUsers,
            'concurrency' => $concurrency,
            'config'      => $config,
        ]);
    }

    public function adminGetSettings()
    {
        [$t1, $t2] = self::tierThresholds();
        $hasKey = !empty(SystemSetting::getRawValue('fine_matting_api_key', ''));
        return response()->json([
            'fine_matting_enabled'          => (bool) SystemSetting::getValue('fine_matting_enabled', false),
            'has_fine_matting_api_key'      => $hasKey,
            'fine_matting_tier1_credit'     => self::tierCredit(1),
            'fine_matting_tier2_credit'     => self::tierCredit(2),
            'fine_matting_tier3_credit'     => self::tierCredit(3),
            'fine_matting_tier_threshold_1' => $t1,
            'fine_matting_tier_threshold_2' => $t2,
        ]);
    }

    public function adminUpdateSettings(Request $request)
    {
        $v = Validator::make($request->all(), [
            'fine_matting_enabled'          => 'sometimes|boolean',
            'fine_matting_api_key'          => 'sometimes|nullable|string|max:500',
            'fine_matting_tier1_credit'     => 'sometimes|nullable|numeric|min:0',
            'fine_matting_tier2_credit'     => 'sometimes|nullable|numeric|min:0',
            'fine_matting_tier3_credit'     => 'sometimes|nullable|numeric|min:0',
            'fine_matting_tier_threshold_1' => 'sometimes|nullable|integer|min:1',
            'fine_matting_tier_threshold_2' => 'sometimes|nullable|integer|min:1',
        ]);
        if ($v->fails()) {
            return response()->json(['error' => $v->errors()->first()], 422);
        }

        // 阈值关系校验：t2 必须大于 t1
        if ($request->filled('fine_matting_tier_threshold_1') && $request->filled('fine_matting_tier_threshold_2')) {
            if ((int) $request->input('fine_matting_tier_threshold_2') <= (int) $request->input('fine_matting_tier_threshold_1')) {
                return response()->json(['error' => '档2阈值（8K 界限）必须大于档1阈值（4K 界限）'], 422);
            }
        }

        foreach (self::SETTING_KEYS as $key) {
            if (!$request->has($key)) continue;
            $val = $request->input($key);
            // API Key 留空 / null 表示保持原值
            if ($key === 'fine_matting_api_key' && ($val === '' || $val === null)) {
                continue;
            }
            // 三档单价留空 → 0（按 0 扣费）
            if (in_array($key, ['fine_matting_tier1_credit', 'fine_matting_tier2_credit', 'fine_matting_tier3_credit'], true)
                && ($val === '' || $val === null)) {
                $val = 0;
            }
            // 阈值留空 → 用 config 兜底
            if ($key === 'fine_matting_tier_threshold_1' && ($val === '' || $val === null)) {
                $val = (int) config('koukoutu.fine_matting.tier_threshold_1', 4096);
            }
            if ($key === 'fine_matting_tier_threshold_2' && ($val === '' || $val === null)) {
                $val = (int) config('koukoutu.fine_matting.tier_threshold_2', 7680);
            }
            SystemSetting::setValue($key, $val);
        }
        return $this->adminGetSettings();
    }

    public function adminTest(Request $request, KoukoutuMattingService $svc)
    {
        $v = Validator::make($request->all(), [
            'image' => 'required|file',
        ]);
        if ($v->fails()) return response()->json(['error' => $v->errors()->first()], 422);

        try {
            $svc->configure(self::resolveCreds());
        } catch (Throwable $e) {
            return response()->json(['ok' => false, 'error' => $e->getMessage()], 400);
        }

        $file = $request->file('image');
        $ext  = strtolower($file->getClientOriginalExtension() ?: $file->extension());
        $temp = storage_path('app/tmp/fine-matting/admin-test-' . Str::uuid() . ".{$ext}");
        if (!is_dir(dirname($temp))) @mkdir(dirname($temp), 0775, true);
        $file->move(dirname($temp), basename($temp));

        [$width, $height] = $this->probeImageSize($temp);
        $tier = self::resolveTier(max($width, $height));

        try {
            $result = $svc->segmentLocalFile($temp);
            @unlink($temp);
            return response()->json([
                'ok'     => true,
                'result' => $result,
                'width'  => $width,
                'height' => $height,
                'tier'   => $tier,
                'cost'   => self::tierCredit($tier),
            ]);
        } catch (Throwable $e) {
            @unlink($temp);
            return response()->json(['ok' => false, 'error' => $e->getMessage()], 500);
        }
    }

    // ===== Helpers =====

    /**
     * 读 API Key 明文（供 Service 注入 / Job 使用）。使用后不要返回给 API 响应。
     */
    public static function resolveCreds(): string
    {
        return (string) SystemSetting::getRawValue('fine_matting_api_key', '');
    }

    /** 三档长边阈值（像素）：[档1上界, 档2上界]，双重兜底防 0 / 逆序。 */
    public static function tierThresholds(): array
    {
        $t1 = (int) SystemSetting::getValue('fine_matting_tier_threshold_1', (int) config('koukoutu.fine_matting.tier_threshold_1', 4096));
        $t2 = (int) SystemSetting::getValue('fine_matting_tier_threshold_2', (int) config('koukoutu.fine_matting.tier_threshold_2', 7680));
        if ($t1 <= 0) $t1 = (int) config('koukoutu.fine_matting.tier_threshold_1', 4096);
        if ($t2 <= $t1) $t2 = max($t1 + 1, (int) config('koukoutu.fine_matting.tier_threshold_2', 7680));
        return [$t1, $t2];
    }

    /** 按长边像素落档：1=4K 以下 / 2=4K–8K / 3=8K 以上；探测失败兜底档1。 */
    public static function resolveTier(int $maxSide): int
    {
        [$t1, $t2] = self::tierThresholds();
        if ($maxSide <= 0) return 1;
        if ($maxSide < $t1) return 1;
        if ($maxSide < $t2) return 2;
        return 3;
    }

    /** 某档单价（本系统积分），未配置为 0。 */
    public static function tierCredit(int $tier): float
    {
        $key = match ($tier) {
            2 => 'fine_matting_tier2_credit',
            3 => 'fine_matting_tier3_credit',
            default => 'fine_matting_tier1_credit',
        };
        return max(0, (float) SystemSetting::getValue($key, 0));
    }

    private function probeImageSize(string $path): array
    {
        $info = @getimagesize($path);
        if (is_array($info) && (int) ($info[0] ?? 0) > 0 && (int) ($info[1] ?? 0) > 0) {
            return [(int) $info[0], (int) $info[1]];
        }
        return [0, 0];
    }
}
