<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\Build\BuildDispatchPause;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class QueueAdminController extends Controller
{
    /** GET /admin/api/queue/status */
    public function status(): JsonResponse
    {
        $paused = BuildDispatchPause::paused();

        $byStatus = DB::table('build_requests')
            ->select('status', DB::raw('count(*) as cnt'))
            ->whereIn('status', ['queued', 'building', 'success', 'delivered', 'failed', 'cancelled', 'expired', 'purged'])
            ->groupBy('status')
            ->pluck('cnt', 'status');

        $oneHourAgo = now()->subHour();
        $recentSuccess = DB::table('build_requests')
            ->where('status', 'success')
            ->where('finished_at', '>=', $oneHourAgo)
            ->count();
        $recentFailed = DB::table('build_requests')
            ->whereIn('status', ['failed', 'cancelled', 'expired'])
            ->where('finished_at', '>=', $oneHourAgo)
            ->count();

        return response()->json([
            'paused' => $paused,
            'queued' => (int) ($byStatus['queued'] ?? 0),
            'building' => (int) ($byStatus['building'] ?? 0),
            'last_hour' => [
                'success' => $recentSuccess,
                'failed_or_cancelled' => $recentFailed,
            ],
            'totals' => $byStatus,
        ], 200);
    }

    /** POST /admin/api/queue/pause */
    public function pause(): JsonResponse
    {
        BuildDispatchPause::pause();
        return response()->json(['paused' => true], 200);
    }

    /** POST /admin/api/queue/resume */
    public function resume(): JsonResponse
    {
        BuildDispatchPause::resume();
        return response()->json(['paused' => false], 200);
    }
}
