<?php

namespace App\Http\Controllers;

use App\Models\UpdateLog;
use App\Services\UpdateService;
use Illuminate\Http\Request;

class UpdateController extends Controller
{
    public function __construct(protected UpdateService $service) {}

    /**
     * 当前版本信息（不访问网络，快速返回）
     * GET /admin/api/updates/current
     */
    public function current()
    {
        return response()->json([
            'version' => $this->service->currentVersion(),
            'released_at' => $this->service->currentReleasedAt(),
            'name' => config('version.name', 'Agent Build'),
            'writable' => $this->service->probeWritable(),
        ]);
    }

    /**
     * 检查更新（拉远端 version.json）
     * GET /admin/api/updates/check
     */
    public function check()
    {
        $writable = $this->service->probeWritable();

        try {
            $info = $this->service->check();
        } catch (\Throwable $e) {
            return response()->json([
                'error' => $e->getMessage(),
                'writable' => $writable,
            ], 502);
        }

        $running = $this->service->runningLog();

        return response()->json(array_merge($info, [
            'running_log_id' => $running?->id,
            'writable' => $writable,
        ]));
    }

    /**
     * 启动升级
     * POST /admin/api/updates/apply
     */
    public function apply(Request $request)
    {
        $user = auth()->user();
        try {
            $log = $this->service->apply(
                operatorId: (int) ($user->id ?? 0),
                operatorName: (string) ($user->username ?? $user->nickname ?? 'unknown'),
            );
        } catch (\Throwable $e) {
            return response()->json([
                'error' => $e->getMessage(),
            ], 409);
        }

        return response()->json([
            'log_id' => $log->id,
            'from_version' => $log->from_version,
            'to_version' => $log->to_version,
            'status' => $log->status,
            'phase' => $log->phase,
            'progress_percent' => $log->progress_percent,
            'started_at' => $log->started_at,
            'message' => '升级任务已启动，请通过进度接口查询执行状态',
        ]);
    }

    /**
     * 查询升级进度
     * GET /admin/api/updates/progress?log_id=xxx
     */
    public function progress(Request $request)
    {
        $logId = $request->query('log_id') ? (int) $request->query('log_id') : null;
        $log = $this->service->progress($logId);
        if (!$log) {
            return response()->json([
                'log' => null,
                'message' => '暂无升级记录',
            ]);
        }
        return response()->json([
            'log' => $this->formatLog($log),
        ]);
    }

    /**
     * 升级历史
     * GET /admin/api/updates/history?per_page=20
     */
    public function history(Request $request)
    {
        $perPage = min(100, max(5, (int) $request->query('per_page', 20)));
        $page = $this->service->history($perPage);
        $items = collect($page->items())->map(fn ($l) => $this->formatLog($l, false))->all();
        return response()->json([
            'data' => $items,
            'total' => $page->total(),
            'per_page' => $page->perPage(),
            'current_page' => $page->currentPage(),
        ]);
    }

    /**
     * 数据表完整性检查
     * GET /admin/api/updates/db-check
     */
    public function dbCheck()
    {
        try {
            return response()->json($this->service->checkDatabase());
        } catch (\Throwable $e) {
            return response()->json([
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * 一键修复数据表（执行 migrate --force）
     * POST /admin/api/updates/db-repair
     */
    public function dbRepair()
    {
        try {
            $result = $this->service->repairDatabase();
            $status = $result['success'] ? 200 : 500;
            return response()->json($result, $status);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
            ], 409);
        }
    }

    /**
     * 历代版本更新记录
     * GET /admin/api/updates/releases
     */
    public function releases()
    {
        return response()->json($this->service->releases());
    }

    protected function formatLog(UpdateLog $log, bool $withFullLog = true): array
    {
        return [
            'id' => $log->id,
            'from_version' => $log->from_version,
            'to_version' => $log->to_version,
            'status' => $log->status,
            'phase' => $log->phase,
            'progress_percent' => $log->progress_percent,
            'zip_url' => $log->zip_url,
            'zip_sha256' => $log->zip_sha256,
            'zip_size' => (int) $log->zip_size,
            'backup_path' => $log->backup_path,
            'operator_id' => $log->operator_id,
            'operator_name' => $log->operator_name,
            'started_at' => optional($log->started_at)->format('Y-m-d H:i:s'),
            'finished_at' => optional($log->finished_at)->format('Y-m-d H:i:s'),
            'duration_seconds' => $log->duration_seconds,
            'error_message' => $log->error_message,
            'created_at' => optional($log->created_at)->format('Y-m-d H:i:s'),
            'log' => $withFullLog ? (string) $log->log : null,
        ];
    }
}
