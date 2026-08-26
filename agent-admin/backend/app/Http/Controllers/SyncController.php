<?php

namespace App\Http\Controllers;

use App\Models\SyncBlob;
use App\Models\SyncDevice;
use App\Models\SyncRecord;
use App\Models\SystemSetting;
use App\Models\UserStorage;
use App\Services\StorageQuotaService;
use App\Services\SyncService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * 桌面端云同步：结构化数据增量 pull / push，以及容量查询。
 */
class SyncController extends Controller
{
    private function enabled(): bool
    {
        return (bool) SystemSetting::getValue('sync_enabled', true);
    }

    public function pull(Request $request)
    {
        if (!$this->enabled()) {
            return response()->json(['error' => 'sync_disabled'], 403);
        }
        $user = auth()->user();
        $since = (int) $request->input('since_seq', 0);
        $limit = (int) $request->input('limit', 500);
        $result = app(SyncService::class)->pull($user, $since, $limit);
        return response()->json($result);
    }

    public function push(Request $request)
    {
        if (!$this->enabled()) {
            return response()->json(['error' => 'sync_disabled'], 403);
        }
        $user = auth()->user();
        $changes = $request->input('changes', []);
        if (!is_array($changes)) $changes = [];
        // 单次 push 体量保护
        if (count($changes) > 1000) {
            $changes = array_slice($changes, 0, 1000);
        }
        $deviceId = (string) $request->input('device_id', '');
        $result = app(SyncService::class)->push($user, $changes, $deviceId);
        return response()->json($result);
    }

    public function quota()
    {
        $user = auth()->user();
        return response()->json(app(StorageQuotaService::class)->info($user->id));
    }

    // ============== 管理后台 ==============

    public function adminStats()
    {
        $byCategory = SyncBlob::where('status', 'committed')
            ->select('category', DB::raw('COUNT(*) as cnt'), DB::raw('COALESCE(SUM(size),0) as bytes'))
            ->groupBy('category')
            ->get()
            ->keyBy('category');

        $byDriver = SyncBlob::where('status', 'committed')
            ->select('storage_driver', DB::raw('COUNT(*) as cnt'))
            ->groupBy('storage_driver')
            ->pluck('cnt', 'storage_driver');

        return response()->json([
            'used_total' => (int) UserStorage::sum('used_bytes'),
            'user_count' => (int) UserStorage::where('used_bytes', '>', 0)->count(),
            'blob_count' => (int) SyncBlob::where('status', 'committed')->count(),
            'blob_bytes' => (int) SyncBlob::where('status', 'committed')->sum('size'),
            'record_count' => (int) SyncRecord::count(),
            'by_category' => [
                'image' => (int) ($byCategory['image']->bytes ?? 0),
                'video' => (int) ($byCategory['video']->bytes ?? 0),
                'data' => (int) ($byCategory['data']->bytes ?? 0),
            ],
            'by_driver' => [
                'local' => (int) ($byDriver['local'] ?? 0),
                'cos' => (int) ($byDriver['cos'] ?? 0),
                'oss' => (int) ($byDriver['oss'] ?? 0),
            ],
        ]);
    }

    public function adminUsers(Request $request)
    {
        $page = max(1, (int) $request->input('page', 1));
        $per = min(100, max(1, (int) $request->input('per_page', 20)));
        $quota = app(StorageQuotaService::class);

        $q = UserStorage::query()
            ->join('users', 'users.id', '=', 'user_storage.user_id')
            ->select('user_storage.user_id', 'user_storage.used_bytes', 'users.username', 'users.nickname');

        if ($request->filled('user_id')) {
            $q->where('user_storage.user_id', (int) $request->input('user_id'));
        }
        if ($request->filled('keyword')) {
            $kw = (string) $request->input('keyword');
            $q->where(function ($w) use ($kw) {
                $w->where('users.username', 'like', "%{$kw}%")
                    ->orWhere('users.nickname', 'like', "%{$kw}%");
            });
        }

        $total = (clone $q)->count();
        $rows = $q->orderByDesc('user_storage.used_bytes')->forPage($page, $per)->get();

        $data = $rows->map(function ($r) use ($quota) {
            $uid = (int) $r->user_id;
            $blobCount = (int) SyncBlob::where('user_id', $uid)->where('status', 'committed')->count();
            $lastSync = SyncDevice::where('user_id', $uid)->max('last_sync_at');
            $totalQuota = $quota->totalQuota($uid);
            return [
                'user_id' => $uid,
                'username' => $r->username,
                'nickname' => $r->nickname,
                'used_bytes' => (int) $r->used_bytes,
                'total_quota' => $totalQuota === PHP_INT_MAX ? 0 : $totalQuota,
                'unlimited' => $totalQuota === PHP_INT_MAX,
                'blob_count' => $blobCount,
                'last_sync_at' => $lastSync,
            ];
        });

        return response()->json(['data' => $data, 'total' => $total]);
    }

    public function adminReconcile()
    {
        \Illuminate\Support\Facades\Artisan::call('sync:reconcile-storage');
        return response()->json(['ok' => true, 'output' => trim(\Illuminate\Support\Facades\Artisan::output())]);
    }

    public function adminRecompute(Request $request, $userId)
    {
        $used = app(StorageQuotaService::class)->recompute((int) $userId);
        return response()->json(['ok' => true, 'used_bytes' => $used]);
    }
}
