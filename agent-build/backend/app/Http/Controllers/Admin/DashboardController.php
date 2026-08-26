<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DashboardController extends Controller
{
    /** GET /admin/api/dashboard/stats?range=day|week|month */
    public function stats(Request $request): JsonResponse
    {
        $range = $request->query('range', 'week');
        $days = match ($range) {
            'day' => 1,
            'week' => 7,
            'month' => 30,
            default => 7,
        };
        $since = now()->subDays($days);

        // Overall counts
        $byStatus = DB::table('build_requests')
            ->where('created_at', '>=', $since)
            ->select('status', DB::raw('count(*) as cnt'))
            ->groupBy('status')
            ->pluck('cnt', 'status');

        $byPlatform = DB::table('build_requests')
            ->where('created_at', '>=', $since)
            ->select('platform', DB::raw('count(*) as cnt'))
            ->groupBy('platform')
            ->pluck('cnt', 'platform');

        // Top clients
        $topClients = DB::table('build_requests')
            ->where('created_at', '>=', $since)
            ->select('client_id', DB::raw('count(*) as cnt'))
            ->groupBy('client_id')
            ->orderByDesc('cnt')
            ->limit(10)
            ->get();

        // Daily series
        $daily = DB::table('build_requests')
            ->where('created_at', '>=', $since)
            ->select(
                DB::raw('DATE(created_at) as day'),
                'status',
                DB::raw('count(*) as cnt')
            )
            ->groupBy('day', 'status')
            ->orderBy('day')
            ->get();

        $clientsActive = DB::table('authorized_clients')->where('status', 'active')->count();
        $clientsTotal = DB::table('authorized_clients')->count();
        $templatesTotal = DB::table('template_versions')->count();
        $currentTemplate = DB::table('template_versions')->where('is_current', 1)->value('version');

        return response()->json([
            'range' => $range,
            'days' => $days,
            'since' => $since->toIso8601String(),
            'totals' => [
                'all_in_range' => array_sum(iterator_to_array($byStatus)),
                'success' => (int) ($byStatus['success'] ?? 0) + (int) ($byStatus['delivered'] ?? 0) + (int) ($byStatus['purged'] ?? 0),
                'failed' => (int) ($byStatus['failed'] ?? 0) + (int) ($byStatus['expired'] ?? 0),
                'cancelled' => (int) ($byStatus['cancelled'] ?? 0),
                'in_progress' => (int) ($byStatus['queued'] ?? 0) + (int) ($byStatus['building'] ?? 0),
            ],
            'by_status' => $byStatus,
            'by_platform' => $byPlatform,
            'top_clients' => $topClients,
            'daily_series' => $daily,
            'clients' => [
                'active' => $clientsActive,
                'total' => $clientsTotal,
            ],
            'templates' => [
                'total' => $templatesTotal,
                'current' => $currentTemplate,
            ],
        ], 200);
    }
}
