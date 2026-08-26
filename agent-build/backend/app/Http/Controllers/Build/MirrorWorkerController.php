<?php

namespace App\Http\Controllers\Build;

use App\Http\Controllers\Controller;
use App\Services\Build\BuildDispatchPause;
use App\Services\Build\BuildWakeService;
use App\Services\Build\QuotaService;
use App\Services\SystemSetting\SettingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;

/**
 * 0.5.0：家庭电脑 mirror worker API。
 *
 * 五个端点（全部走 mirror_worker 中间件，Bearer worker_token 鉴权）：
 *
 *   GET  /api/build/mirror/pending       - 待镜像列表（家庭电脑要去 download → SFTP push）
 *   POST /api/build/mirror/{id}/ack      - 上报 mirror 完成 + URL
 *   POST /api/build/mirror/{id}/fail     - 上报 mirror 失败（重试 N 次后放弃）
 *   GET  /api/build/mirror/purgeable     - 待清理列表（云控端已 ack delivered 可清 mirror 文件）
 *   POST /api/build/mirror/{id}/purge-ack - 上报 SFTP 删除完成
 *
 * 单 worker 假设：用户场景一台家庭电脑跑一份脚本。但仍用 mirror_assigned_at 防止
 * 万一多 worker 重复领（过 N 分钟未 ack 的可被其他 worker 重领）。
 */
class MirrorWorkerController extends Controller
{
    /**
     * 领取超时时间（分钟）：超过此时间未 ack 视为 worker 失联，build 可被重领。
     * 取 90 分钟以覆盖 mac 双 100MB+ 包跨境下载的最坏耗时——worker 领取后下载 40-60 分钟
     * 期间 mirror_assigned_at 不会更新，若阈值过小（旧值 15）会在下载途中被误判超时而重复
     * 领取、重复下载。与 MirrorWatchdog::MIRRORING_TIMEOUT_MINUTES 对齐。
     */
    private const ASSIGNMENT_TIMEOUT_MINUTES = 90;

    /** 一次返回的最大条数。 */
    private const PAGE_LIMIT = 10;

    /**
     * GET /api/build/mirror/pending
     *
     * 返回待镜像 build 列表。每条包含家庭电脑下载所需的全部信息：
     *   - build_id（主键）
     *   - app_name / platform / app_version（日志友好）
     *   - release_tag / release_assets（GitHub 下载入口）
     *
     * 同时把 mirror_assigned_at 写为 now()，下次 30s poll 时同一条不会被重复返回
     * （除非超 ASSIGNMENT_TIMEOUT_MINUTES 视为 worker 失联，可被重领）。
     */
    public function pending(Request $request, SettingService $settings): JsonResponse
    {
        // worker 心跳：无论本轮有无可领的 build，每次 poll 都刷新，供 MirrorWatchdog 判定 worker 是否失联。
        // 同时顺带捕获 worker 的公网出口IP（家庭电脑直连下载特性用，见 config/build.php direct_mirror）。
        // 失败不阻塞领取流程（心跳只是观测信号）。
        try {
            $beat = ['worker_last_poll_at' => (string) now()];
            $workerIp = $this->extractWorkerIp($request);
            if ($workerIp !== null) {
                $beat['worker_ip'] = $workerIp;
                $beat['worker_ip_at'] = (string) now();
            }
            $settings->setGroup('mirror', $beat);
        } catch (\Throwable $e) {
            // ignore：DB 抖动时丢一次心跳无所谓，下一轮 30s 后再写
        }

        if (BuildDispatchPause::paused()) {
            return response()->json(['items' => [], 'paused' => true], 200);
        }

        $cutoff = now()->subMinutes(self::ASSIGNMENT_TIMEOUT_MINUTES);

        // 候选：mirror_status=pending（从未领过 + 已超时未 ack 重领）
        // 用 SELECT FOR UPDATE 过滤一致性视图，但 Laravel DB::table 的 lockForUpdate
        // 配合 transaction 即可。这里采用更轻的策略：
        //   1) 先 select 一批候选 build_id
        //   2) UPDATE...WHERE mirror_assigned_at IS NULL OR < cutoff（CAS 抢占）
        //   3) 二次 select 拿到真正抢到的行
        // 单 worker 场景这套两阶段足够；多 worker 场景也能保证 at-most-once 领取。

        // 复查修正：WHERE 接受 'pending' 和 'mirroring' 两种状态。
        // 原因：worker 领取后状态抢占为 'mirroring'，如果 worker 进程崩溃 / 主机宕机，
        // mirror_status 就永远卡在 'mirroring'。现在配合 mirror_assigned_at < cutoff
        // 超时检查，超 15 min 未 ack 的 'mirroring' 会被重领。
        $candidates = DB::table('build_requests')
            ->where('status', 'success')
            ->whereIn('mirror_status', ['pending', 'mirroring'])
            ->where(function ($q) use ($cutoff) {
                $q->whereNull('mirror_assigned_at')
                  ->orWhere('mirror_assigned_at', '<', $cutoff);
            })
            ->orderBy('finished_at')
            ->limit(self::PAGE_LIMIT)
            ->pluck('build_id')
            ->all();

        if (empty($candidates)) {
            return response()->json(['items' => []], 200);
        }

        $now = now();
        $claimed = [];
        foreach ($candidates as $buildId) {
            $affected = DB::table('build_requests')
                ->where('build_id', $buildId)
                ->where('status', 'success')
                ->whereIn('mirror_status', ['pending', 'mirroring'])
                ->where(function ($q) use ($cutoff) {
                    $q->whereNull('mirror_assigned_at')
                      ->orWhere('mirror_assigned_at', '<', $cutoff);
                })
                ->update([
                    'mirror_status' => 'mirroring',
                    'mirror_assigned_at' => $now,
                    'updated_at' => $now,
                ]);
            if ($affected === 1) {
                $claimed[] = $buildId;
            }
        }

        if (empty($claimed)) {
            return response()->json(['items' => []], 200);
        }

        $rows = DB::table('build_requests')
            ->whereIn('build_id', $claimed)
            ->orderBy('finished_at')
            ->get([
                'build_id', 'app_name', 'platform', 'app_version',
                'release_tag', 'release_assets',
                'finished_at', 'mirror_assigned_at',
            ]);

        $items = [];
        foreach ($rows as $r) {
            $items[] = [
                'build_id' => $r->build_id,
                'app_name' => $r->app_name,
                'platform' => $r->platform,
                'app_version' => $r->app_version,
                'release_tag' => $r->release_tag,
                'release_assets' => $this->decodeJsonField($r->release_assets),
                'finished_at' => $r->finished_at,
                'assigned_at' => $r->mirror_assigned_at,
            ];
        }

        Log::info('[MirrorWorker] pending claimed', [
            'count' => count($items),
            'build_ids' => array_column($items, 'build_id'),
        ]);

        return response()->json(['items' => $items], 200);
    }

    /**
     * POST /api/build/mirror/{buildId}/ack
     *
     * Body:
     * {
     *   "mirror_url_primary": "https://your-cdn-domain.example.com/build-mirror/{id}/setup.exe",
     *   "mirror_supplementary": [
     *     {"filename":"...","url":"https://...","role":"blockmap","size":...,"sha256":"..."}
     *   ]
     * }
     *
     * 成功条件：mirror_status='mirroring'（家庭电脑领过的）才能 ack 成 mirrored；
     *           其他状态返 409。
     *
     * 副作用：
     *  - mirror_status='mirrored'，mirror_acked_at=now()
     *  - 触发 wake：通知云控端立刻来拉
     */
    public function ack(Request $request, string $buildId, BuildWakeService $wake): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'mirror_url_primary' => ['required', 'url', 'max:500'],
            'mirror_supplementary' => ['nullable', 'array'],
            'mirror_supplementary.*.filename' => ['required_with:mirror_supplementary', 'string', 'max:255'],
            'mirror_supplementary.*.url' => ['required_with:mirror_supplementary', 'url', 'max:500'],
            'mirror_supplementary.*.role' => ['required_with:mirror_supplementary', 'string', 'in:primary,blockmap,metadata'],
            'mirror_supplementary.*.size' => ['nullable', 'integer'],
            'mirror_supplementary.*.sha256' => ['nullable', 'string', 'max:64'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $build = DB::table('build_requests')->where('build_id', $buildId)->first();
        if (!$build) {
            return response()->json(['error' => 'build_not_found'], 404);
        }

        // 复查修正：幂等。
        // 场景：worker 上次 ack 实际成功但响应丢包（网络抖动）→ worker 进 processPending
        // catch 重试 ack → controller 上次已设 mirror_status='mirrored'。不幂等会 409
        // 导致 worker 认为失败进重试循环，最后调 fail 误标为失败。
        if ($build->mirror_status === 'mirrored') {
            return response()->json(['status' => 'mirrored', 'idempotent' => true], 200);
        }

        if ($build->mirror_status !== 'mirroring') {
            return response()->json([
                'error' => 'invalid_state_for_ack',
                'current_mirror_status' => $build->mirror_status,
            ], 409);
        }

        $now = now();
        DB::table('build_requests')->where('build_id', $buildId)->update([
            'mirror_status' => 'mirrored',
            'mirror_url_primary' => $request->input('mirror_url_primary'),
            'mirror_supplementary' => json_encode(
                $request->input('mirror_supplementary', []),
                JSON_UNESCAPED_SLASHES
            ),
            'mirror_acked_at' => $now,
            'updated_at' => $now,
        ]);

        Log::info('[MirrorWorker] ack mirrored', [
            'build_id' => $buildId,
            'primary' => $request->input('mirror_url_primary'),
        ]);

        // wake 云控端立刻来拉。失败不阻塞 ack（worker 视角：本地工作已完成）。
        try {
            $client = DB::table('authorized_clients')->where('client_id', $build->client_id)->first();
            if ($client) {
                $wake->wakeClient($client, $buildId);
            }
        } catch (\Throwable $e) {
            Log::warning('[MirrorWorker] wake exception (non-blocking)', [
                'build_id' => $buildId,
                'error' => $e->getMessage(),
            ]);
        }

        return response()->json(['status' => 'mirrored'], 200);
    }

    /**
     * POST /api/build/mirror/{buildId}/fail
     *
     * Body:
     * { "error": "github_download_failed_after_3_retries" }
     *
     * 家庭电脑重试 N 次仍失败后调，把整条 build 标 failed 并退当日配额（首次失败才退）。
     * 同时发 wake 让云控端立即同步 status=failed（不然 admin UI 一直显示「排队中」）。
     */
    public function fail(Request $request, string $buildId, QuotaService $quota, BuildWakeService $wake): JsonResponse
    {
        $errMsg = (string) $request->input('error', 'mirror_worker_failed');

        $build = DB::table('build_requests')->where('build_id', $buildId)->first();
        if (!$build) {
            return response()->json(['error' => 'build_not_found'], 404);
        }

        // 复查修正：幂等。worker 可能重复调 fail（如上次响应丢包）。
        if ($build->mirror_status === 'failed') {
            return response()->json(['status' => 'failed', 'idempotent' => true], 200);
        }

        if (!in_array($build->mirror_status, ['pending', 'mirroring'], true)) {
            return response()->json([
                'error' => 'invalid_state_for_fail',
                'current_mirror_status' => $build->mirror_status,
            ], 409);
        }

        $wasFailed = $build->status === 'failed';
        $now = now();

        DB::table('build_requests')->where('build_id', $buildId)->update([
            'status' => 'failed',
            'mirror_status' => 'failed',
            'finished_at' => $build->finished_at ?? $now,
            'error_message' => 'mirror_failed: ' . $errMsg,
            'updated_at' => $now,
        ]);

        // 仅首次失败退配额，避免 worker 重复调 fail 导致重复退。
        if (!$wasFailed) {
            $createdDate = date('Y-m-d', strtotime($build->created_at));
            $quota->decrDailyCount($build->client_id, $createdDate);
        }

        Log::error('[MirrorWorker] mirror failed', [
            'build_id' => $buildId,
            'error' => $errMsg,
        ]);

        try {
            $client = DB::table('authorized_clients')->where('client_id', $build->client_id)->first();
            if ($client) {
                $wake->wakeClient($client, $buildId);
            }
        } catch (\Throwable $e) {
            Log::warning('[MirrorWorker] wake on fail exception (non-blocking)', [
                'build_id' => $buildId,
                'error' => $e->getMessage(),
            ]);
        }

        return response()->json(['status' => 'failed'], 200);
    }

    /**
     * GET /api/build/mirror/purgeable
     *
     * 返回待清理列表：status=delivered AND mirror_status=mirrored
     * 即云控端已 ack 落盘成功，本地服务器上的 mirror 文件可以删了。
     *
     * 同 pending 用 mirror_assigned_at 做防重领，但语义复用同字段（worker 一次只做一类）。
     * 也用 mirror_status='purging' 中间态防止云控端 wake 后再次拉时找到 mirror_url
     * 误以为还能拉（虽然这时云控端不会再来拉，但状态机一致性更好）。
     */
    public function purgeable(Request $request): JsonResponse
    {
        $cutoff = now()->subMinutes(self::ASSIGNMENT_TIMEOUT_MINUTES);

        // 复查修正：同 pending 逻辑——接受 'mirrored' 和 'purging'，配合 cutoff 处理
        // worker 领取后崩溃卡在 'purging' 的场景。
        $candidates = DB::table('build_requests')
            ->where('status', 'delivered')
            ->whereIn('mirror_status', ['mirrored', 'purging'])
            ->where(function ($q) use ($cutoff) {
                $q->whereNull('mirror_assigned_at')
                  ->orWhere('mirror_assigned_at', '<', $cutoff);
            })
            ->orderBy('delivered_at')
            ->limit(self::PAGE_LIMIT)
            ->pluck('build_id')
            ->all();

        if (empty($candidates)) {
            return response()->json(['items' => []], 200);
        }

        $now = now();
        $claimed = [];
        foreach ($candidates as $buildId) {
            $affected = DB::table('build_requests')
                ->where('build_id', $buildId)
                ->where('status', 'delivered')
                ->whereIn('mirror_status', ['mirrored', 'purging'])
                ->where(function ($q) use ($cutoff) {
                    $q->whereNull('mirror_assigned_at')
                      ->orWhere('mirror_assigned_at', '<', $cutoff);
                })
                ->update([
                    'mirror_status' => 'purging',
                    'mirror_assigned_at' => $now,
                    'updated_at' => $now,
                ]);
            if ($affected === 1) {
                $claimed[] = $buildId;
            }
        }

        if (empty($claimed)) {
            return response()->json(['items' => []], 200);
        }

        $rows = DB::table('build_requests')
            ->whereIn('build_id', $claimed)
            ->orderBy('delivered_at')
            ->get([
                'build_id', 'mirror_url_primary', 'mirror_supplementary',
                'delivered_at',
            ]);

        $items = [];
        foreach ($rows as $r) {
            $items[] = [
                'build_id' => $r->build_id,
                'mirror_url_primary' => $r->mirror_url_primary,
                'mirror_supplementary' => $this->decodeJsonField($r->mirror_supplementary),
                'delivered_at' => $r->delivered_at,
            ];
        }

        Log::info('[MirrorWorker] purgeable claimed', [
            'count' => count($items),
            'build_ids' => array_column($items, 'build_id'),
        ]);

        return response()->json(['items' => $items], 200);
    }

    /**
     * POST /api/build/mirror/{buildId}/purge-ack
     *
     * 家庭电脑 SFTP rm -rf 完成后调。状态机：
     *   purging → purged + purged_at=now()
     *
     * 若该 build mirror_status 不是 purging（如已被另一 worker 标 purged，或被运维手工
     * 修过）→ 409，不再覆盖 mirror_status；但仍幂等返回 200 以避免家庭电脑无限重试。
     */
    public function purgeAck(Request $request, string $buildId): JsonResponse
    {
        $build = DB::table('build_requests')->where('build_id', $buildId)->first();
        if (!$build) {
            return response()->json(['error' => 'build_not_found'], 404);
        }

        if ($build->mirror_status === 'purged') {
            // 幂等：worker 重复调，已是终态，直接 200。
            return response()->json(['status' => 'purged', 'idempotent' => true], 200);
        }

        if ($build->mirror_status !== 'purging') {
            return response()->json([
                'error' => 'invalid_state_for_purge_ack',
                'current_mirror_status' => $build->mirror_status,
            ], 409);
        }

        $now = now();
        DB::table('build_requests')->where('build_id', $buildId)->update([
            'mirror_status' => 'purged',
            'purged_at' => $now,
            'updated_at' => $now,
        ]);

        Log::info('[MirrorWorker] purge acked', ['build_id' => $buildId]);

        return response()->json(['status' => 'purged'], 200);
    }

    /**
     * 取 worker 公网出口IP。
     *
     * 优先用 worker 自报的 X-Worker-Public-Ip 头：家庭电脑用外部回显服务测出自己的公网IP后
     * 主动塞进请求头，这正是客户直连 :893 要连的那个地址，且「不依赖」TrustProxies/XFF 是否
     * 正确配置（本服务 TrustProxies::$proxies 为空 = 不信任任何代理，$request->ip() 只会
     * 拿到 CDN/nginx 对端而非家庭电脑真实公网IP）。头缺失时才回退 $request->ip() 兜底。
     */
    private function extractWorkerIp(Request $request): ?string
    {
        $hdr = trim((string) $request->header('X-Worker-Public-Ip', ''));
        if ($hdr !== '' && filter_var($hdr, FILTER_VALIDATE_IP) !== false) {
            return $hdr;
        }
        $ip = (string) $request->ip();
        return filter_var($ip, FILTER_VALIDATE_IP) !== false ? $ip : null;
    }

    /**
     * 兼容存储：MySQL JSON 列可能以 string 或 array 形式取出（看 PDO 配置）。
     */
    private function decodeJsonField($raw): array
    {
        if (is_string($raw)) {
            $decoded = json_decode($raw, true);
            return is_array($decoded) ? $decoded : [];
        }
        if (is_array($raw)) {
            return $raw;
        }
        return [];
    }
}
