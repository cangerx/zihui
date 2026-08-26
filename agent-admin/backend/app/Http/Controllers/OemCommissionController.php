<?php

namespace App\Http\Controllers;

use App\Models\OemCommissionRecord;
use App\Models\PaymentOrder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class OemCommissionController extends Controller
{
    public function index(Request $request)
    {
        $query = PaymentOrder::query()
            ->select([
                'id', 'order_no', 'user_id', 'plan_id', 'amount', 'currency', 'channel', 'order_type', 'status',
                'oem_project_key', 'commission_user_id', 'commission_rate_snapshot', 'commission_amount', 'commission_status',
                'wx_transaction_id', 'user_plan_id', 'upgrade_from_user_plan_id', 'paid_at', 'closed_at', 'expires_at', 'created_at',
            ])
            ->with(['user:id,username,nickname,phone,email', 'plan:id,code,name']);

        $this->applyFilters($query, $request);

        $summaryQuery = clone $query;
        $summary = [
            'order_amount' => (float)(clone $summaryQuery)->sum('amount'),
            'commission_amount' => (float)(clone $summaryQuery)->sum('commission_amount'),
            'paid_order_amount' => (float)(clone $summaryQuery)->where('status', PaymentOrder::STATUS_PAID)->sum('amount'),
            'confirmed_commission_amount' => (float)(clone $summaryQuery)->where('commission_status', OemCommissionRecord::STATUS_CONFIRMED)->sum('commission_amount'),
            'order_count' => (int)(clone $summaryQuery)->count(),
            'paid_order_count' => (int)(clone $summaryQuery)->where('status', PaymentOrder::STATUS_PAID)->count(),
        ];

        $data = $query->orderByDesc('id')->paginate($request->get('per_page', 50));
        $items = collect($data->items())->map(fn($order) => $this->formatOrder($order));

        return response()->json([
            'data' => $items,
            'total' => $data->total(),
            'current_page' => $data->currentPage(),
            'per_page' => $data->perPage(),
            'summary' => $summary,
        ]);
    }

    public function show($id)
    {
        $order = PaymentOrder::with([
            'user:id,username,nickname,phone,email',
            'plan:id,code,name',
            'userPlan:id,status',
            'commissionRecord',
        ])->findOrFail($id);

        return response()->json($this->formatOrder($order, true));
    }

    public function options()
    {
        $projects = DB::table('oem_projects')
            ->whereNull('deleted_at')
            ->orderBy('id')
            ->get(['project_key', 'name', 'app_name', 'status']);
        $members = DB::table('oem_project_members as m')
            ->join('users as u', 'u.id', '=', 'm.user_id')
            ->join('oem_projects as p', 'p.project_key', '=', 'm.oem_project_key')
            ->whereNull('p.deleted_at')
            ->select('m.user_id', 'u.username', 'u.nickname', 'm.oem_project_key', 'p.name as oem_project_name', 'm.role', 'm.status')
            ->orderBy('m.id')
            ->get();
        return response()->json([
            'projects' => $projects,
            'members' => $members,
        ]);
    }

    private function applyFilters($query, Request $request): void
    {
        if ($request->filled('oem_project_key')) $query->where('oem_project_key', $request->oem_project_key);
        if ($request->filled('commission_user_id')) $query->where('commission_user_id', (int)$request->commission_user_id);
        if ($request->filled('buyer_user_id')) $query->where('user_id', (int)$request->buyer_user_id);
        if ($request->filled('order_status')) $query->where('status', $request->order_status);
        if ($request->filled('commission_status')) $query->where('commission_status', $request->commission_status);
        if ($request->filled('order_type')) $query->where('order_type', $request->order_type);
        if ($request->filled('pay_channel')) $query->where('channel', $request->pay_channel);
        if ($request->filled('created_start')) $query->where('created_at', '>=', $request->created_start . ' 00:00:00');
        if ($request->filled('created_end')) $query->where('created_at', '<=', $request->created_end . ' 23:59:59');
        if ($request->filled('paid_start')) $query->where('paid_at', '>=', $request->paid_start . ' 00:00:00');
        if ($request->filled('paid_end')) $query->where('paid_at', '<=', $request->paid_end . ' 23:59:59');
        if ($request->filled('amount_min')) $query->where('amount', '>=', (float)$request->amount_min);
        if ($request->filled('amount_max')) $query->where('amount', '<=', (float)$request->amount_max);
        if ($request->filled('commission_min')) $query->where('commission_amount', '>=', (float)$request->commission_min);
        if ($request->filled('commission_max')) $query->where('commission_amount', '<=', (float)$request->commission_max);
        if ($request->filled('keyword')) {
            $kw = trim((string)$request->keyword);
            $query->where(function ($q) use ($kw) {
                $q->where('order_no', 'like', "%{$kw}%")
                    ->orWhere('oem_project_key', 'like', "%{$kw}%")
                    ->orWhereHas('user', fn($u) => $u->where('username', 'like', "%{$kw}%")
                        ->orWhere('nickname', 'like', "%{$kw}%")
                        ->orWhere('phone', 'like', "%{$kw}%")
                        ->orWhere('email', 'like', "%{$kw}%"))
                    ->orWhereHas('plan', fn($p) => $p->where('code', 'like', "%{$kw}%")->orWhere('name', 'like', "%{$kw}%"))
                    ->orWhereIn('commission_user_id', function ($sub) use ($kw) {
                        $sub->select('id')
                            ->from('users')
                            ->where('username', 'like', "%{$kw}%")
                            ->orWhere('nickname', 'like', "%{$kw}%");
                    })
                    ->orWhereIn('oem_project_key', function ($sub) use ($kw) {
                        $sub->select('project_key')
                            ->from('oem_projects')
                            ->where('name', 'like', "%{$kw}%")
                            ->orWhere('app_name', 'like', "%{$kw}%")
                            ->orWhere('project_key', 'like', "%{$kw}%");
                    });
            });
        }
    }

    private function formatOrder(PaymentOrder $order, bool $detail = false): array
    {
        $project = $order->oem_project_key
            ? DB::table('oem_projects')->where('project_key', $order->oem_project_key)->first(['project_key', 'name', 'app_name', 'status'])
            : null;
        $commissionUser = $order->commission_user_id
            ? DB::table('users')->where('id', $order->commission_user_id)->first(['id', 'username', 'nickname'])
            : null;
        $arr = $order->toArray();
        $arr['derived_status'] = $order->derivedStatus();
        $arr['oem_project'] = $project;
        $arr['commission_user'] = $commissionUser;
        if ($detail) {
            $arr['commission_record'] = $order->commissionRecord;
        }
        return $arr;
    }
}
