<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * 授权请求记录（只读）。数据来自 VerifyDomainBinding 中间件埋点，
 * 用于排查「域名已授权却报未授权」：查看客户端实际发来的 Origin / host 与拒因。
 * 与项目约定一致：裸 DB 查询，不 import 业务 Model。
 */
class AuthRequestAdminController extends Controller
{
    /** 列表展示列 */
    private const SELECT_COLS = [
        'id', 'result', 'reason', 'origin', 'host', 'referer',
        'client_id', 'client_status', 'ip', 'user_agent', 'admin_version',
        'method', 'path', 'created_at',
    ];

    /** 结果白名单 */
    private const RESULTS = ['allowed', 'denied'];

    /** 原因白名单 */
    private const REASONS = [
        'ok', 'origin_required', 'invalid_origin',
        'domain_not_authorized', 'client_inactive', 'client_expired',
    ];

    /** GET /admin/api/auth-requests */
    public function index(Request $request): JsonResponse
    {
        $page = max(1, (int) $request->query('page', 1));
        $pageSize = min(100, max(1, (int) $request->query('page_size', 20)));

        $q = DB::table('authorization_request_logs');

        $result = $request->query('result');
        if ($result && in_array($result, self::RESULTS, true)) {
            $q->where('result', $result);
        }
        $reason = $request->query('reason');
        if ($reason && in_array($reason, self::REASONS, true)) {
            $q->where('reason', $reason);
        }
        if ($host = (string) $request->query('host', '')) {
            $q->where('host', $host);
        }
        if ($clientId = (string) $request->query('client_id', '')) {
            $q->where('client_id', $clientId);
        }
        // 关键词模糊：origin / host / client_id，用于定位「实际发来的是哪个域名」
        if ($kw = (string) $request->query('keyword', '')) {
            $like = '%' . $kw . '%';
            $q->where(function ($qq) use ($like) {
                $qq->where('origin', 'like', $like)
                    ->orWhere('host', 'like', $like)
                    ->orWhere('client_id', 'like', $like);
            });
        }
        if ($df = $request->query('date_from')) {
            $q->where('created_at', '>=', $df);
        }
        if ($dt = $request->query('date_to')) {
            $q->where('created_at', '<=', $dt);
        }

        $total = (clone $q)->count();
        $rows = $q->orderByDesc('created_at')
            ->skip(($page - 1) * $pageSize)
            ->take($pageSize)
            ->get(self::SELECT_COLS);

        return response()->json([
            'total' => $total,
            'page' => $page,
            'page_size' => $pageSize,
            'items' => $rows,
        ], 200);
    }

    /**
     * POST /admin/api/auth-requests/clear
     * 清空全部「被拒(denied)」记录。成功记录不受影响（其由滚动保留策略自动控量）。
     */
    public function clear(): JsonResponse
    {
        $deleted = DB::table('authorization_request_logs')
            ->where('result', 'denied')
            ->delete();

        return response()->json(['deleted' => $deleted], 200);
    }
}
