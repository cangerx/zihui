<?php

namespace App\Http\Controllers;

use App\Models\OemCommissionRecord;
use App\Models\PaymentOrder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class OemChannelController extends Controller
{
    public function profile()
    {
        $projects = $this->memberProjects();
        return response()->json([
            'has_channel' => $projects->isNotEmpty(),
            'projects' => $projects->values(),
        ]);
    }

    public function summary(Request $request)
    {
        $now = now();
        $year = (int)$request->query('year', $now->year);
        $month = (int)$request->query('month', $now->month);
        if ($year < 2000 || $year > 2100) $year = (int)$now->year;
        if ($month < 1 || $month > 12) $month = (int)$now->month;
        $monthStart = $now->copy()->setDate($year, $month, 1)->startOfDay();
        $monthEnd = $monthStart->copy()->endOfMonth();
        $projects = $this->memberProjects();
        $projectKeys = $projects->pluck('project_key')->all();

        $orders = PaymentOrder::query()
            ->whereIn('oem_project_key', $projectKeys)
            ->where('status', PaymentOrder::STATUS_PAID);

        $commissions = OemCommissionRecord::query()
            ->whereIn('oem_project_key', $projectKeys)
            ->whereIn('status', [OemCommissionRecord::STATUS_CONFIRMED, OemCommissionRecord::STATUS_SETTLED]);

        return response()->json([
            'projects' => $projects->values(),
            'summary' => [
                'total_order_amount' => (float)(clone $orders)->sum('amount'),
                'total_commission_amount' => (float)(clone $commissions)->sum('commission_amount'),
                'month_order_amount' => (float)(clone $orders)->whereBetween('paid_at', [$monthStart, $monthEnd])->sum('amount'),
                'month_commission_amount' => (float)(clone $commissions)->whereBetween('confirmed_at', [$monthStart, $monthEnd])->sum('commission_amount'),
                'paid_order_count' => (int)(clone $orders)->count(),
                'commission_count' => (int)(clone $commissions)->count(),
                'period_year' => $year,
                'period_month' => $month,
            ],
        ]);
    }

    public function orders(Request $request)
    {
        $projectKeys = $this->memberProjects()->pluck('project_key')->all();
        $query = PaymentOrder::query()
            ->select([
                'id', 'order_no', 'user_id', 'plan_id', 'amount', 'currency', 'channel', 'order_type', 'status',
                'oem_project_key', 'commission_rate_snapshot', 'commission_amount', 'commission_status',
                'paid_at', 'closed_at', 'expires_at', 'created_at',
            ])
            ->with(['user:id,username,nickname', 'plan:id,code,name'])
            ->whereIn('oem_project_key', $projectKeys);

        $this->applyOrderFilters($query, $request);

        $data = $query->orderByDesc('id')
            ->paginate($request->get('per_page', 20));
        $items = collect($data->items())->map(function ($order) {
                $arr = $order->toArray();
                $arr['derived_status'] = $order->derivedStatus();
                $arr['oem_project_name'] = $this->projectName($order->oem_project_key);
                return $arr;
            });

        return response()->json([
            'data' => $items,
            'total' => $data->total(),
            'current_page' => $data->currentPage(),
            'per_page' => $data->perPage(),
        ]);
    }

    public function commissions(Request $request)
    {
        $projectKeys = $this->memberProjects()->pluck('project_key')->all();
        $query = OemCommissionRecord::query()
            ->with(['buyer:id,username,nickname', 'plan:id,code,name'])
            ->whereIn('oem_project_key', $projectKeys);

        $this->applyCommissionFilters($query, $request);

        $data = $query->orderByDesc('id')
            ->paginate($request->get('per_page', 20));
        $items = collect($data->items())->map(function ($record) {
                $arr = $record->toArray();
                $arr['oem_project_name'] = $this->projectName($record->oem_project_key);
                return $arr;
            });

        return response()->json([
            'data' => $items,
            'total' => $data->total(),
            'current_page' => $data->currentPage(),
            'per_page' => $data->perPage(),
        ]);
    }

    private function memberProjects()
    {
        return DB::table('oem_project_members as m')
            ->join('oem_projects as p', 'p.project_key', '=', 'm.oem_project_key')
            ->where('m.user_id', auth()->id())
            ->where('m.status', 'active')
            ->whereNull('p.deleted_at')
            ->select([
                'p.project_key', 'p.name', 'p.app_name', 'p.status', 'p.commission_rate', 'p.commission_enabled',
                'm.role', 'm.created_at as bound_at',
            ])
            ->orderBy('p.id')
            ->get()
            ->map(fn($row) => [
                'project_key' => (string)$row->project_key,
                'name' => (string)$row->name,
                'app_name' => (string)$row->app_name,
                'status' => (string)$row->status,
                'commission_rate' => (float)$row->commission_rate,
                'commission_enabled' => (bool)$row->commission_enabled,
                'role' => (string)$row->role,
                'bound_at' => $row->bound_at,
            ]);
    }

    private function applyOrderFilters($query, Request $request): void
    {
        if ($request->filled('oem_project_key')) $query->where('oem_project_key', $request->oem_project_key);
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
        if ($request->filled('keyword')) {
            $kw = trim((string)$request->keyword);
            $query->where(function ($q) use ($kw) {
                $q->where('order_no', 'like', "%{$kw}%")
                    ->orWhereHas('plan', fn($p) => $p->where('code', 'like', "%{$kw}%")->orWhere('name', 'like', "%{$kw}%"))
                    ->orWhereHas('user', fn($u) => $u->where('username', 'like', "%{$kw}%")->orWhere('nickname', 'like', "%{$kw}%"));
            });
        }
    }

    private function applyCommissionFilters($query, Request $request): void
    {
        if ($request->filled('oem_project_key')) $query->where('oem_project_key', $request->oem_project_key);
        if ($request->filled('status')) $query->where('status', $request->status);
        if ($request->filled('created_start')) $query->where('created_at', '>=', $request->created_start . ' 00:00:00');
        if ($request->filled('created_end')) $query->where('created_at', '<=', $request->created_end . ' 23:59:59');
        if ($request->filled('confirmed_start')) $query->where('confirmed_at', '>=', $request->confirmed_start . ' 00:00:00');
        if ($request->filled('confirmed_end')) $query->where('confirmed_at', '<=', $request->confirmed_end . ' 23:59:59');
        if ($request->filled('commission_min')) $query->where('commission_amount', '>=', (float)$request->commission_min);
        if ($request->filled('commission_max')) $query->where('commission_amount', '<=', (float)$request->commission_max);
        if ($request->filled('keyword')) {
            $kw = trim((string)$request->keyword);
            $query->where(function ($q) use ($kw) {
                $q->where('order_no', 'like', "%{$kw}%")
                    ->orWhereHas('plan', fn($p) => $p->where('code', 'like', "%{$kw}%")->orWhere('name', 'like', "%{$kw}%"))
                    ->orWhereHas('buyer', fn($u) => $u->where('username', 'like', "%{$kw}%")->orWhere('nickname', 'like', "%{$kw}%"));
            });
        }
    }

    private function projectName(?string $projectKey): ?string
    {
        if (!$projectKey) return null;
        return DB::table('oem_projects')->where('project_key', $projectKey)->value('name');
    }
}
