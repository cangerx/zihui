<?php

namespace App\Services;

use App\Models\OemCommissionRecord;
use App\Models\PaymentOrder;
use App\Models\Plan;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class OemChannelService
{
    public function channelKeyFromRequest(Request $request): ?string
    {
        $key = trim((string)$request->header('X-OEM-Project-Key', ''));
        if ($key === '') {
            $key = trim((string)$request->input('oem_project_key', ''));
        }
        if ($key === '' || $key === 'default') {
            return null;
        }
        if (!preg_match('/^[A-Za-z0-9_.-]{1,64}$/', $key)) {
            return null;
        }
        $exists = DB::table('oem_projects')
            ->where('project_key', $key)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->exists();
        return $exists ? $key : null;
    }

    public function resolveOrderOemProjectKey(Request $request, User $user): ?string
    {
        $registered = trim((string)($user->register_oem_project_key ?? ''));
        if ($registered !== '' && $this->activeProjectExists($registered)) {
            return $registered;
        }
        return $this->channelKeyFromRequest($request);
    }

    public function captureRegisterSource(Request $request): ?string
    {
        return $this->channelKeyFromRequest($request);
    }

    public function planVisibleToChannel(Plan $plan, ?string $oemProjectKey): bool
    {
        $channelKey = $oemProjectKey ?: 'default';
        return DB::table('plan_channel_visibilities')
            ->where('plan_id', $plan->id)
            ->where('channel_key', $channelKey)
            ->exists();
    }

    public function applyPlanVisibility($query, ?string $oemProjectKey): void
    {
        $channelKey = $oemProjectKey ?: 'default';
        $query->whereExists(function ($sub) use ($channelKey) {
            $sub->select(DB::raw(1))
                ->from('plan_channel_visibilities as pcv')
                ->whereColumn('pcv.plan_id', 'plans.id')
                ->where('pcv.channel_key', $channelKey);
        });
    }

    public function enrichPlanVisibilities($plans): void
    {
        $ids = $plans->pluck('id')->map(fn($v) => (int)$v)->all();
        if (empty($ids)) {
            return;
        }
        $rows = DB::table('plan_channel_visibilities as pcv')
            ->leftJoin('oem_projects as op', 'op.project_key', '=', 'pcv.oem_project_key')
            ->whereIn('pcv.plan_id', $ids)
            ->select('pcv.*', 'op.name as oem_project_name')
            ->orderBy('pcv.channel_type')
            ->orderBy('pcv.sort')
            ->orderBy('pcv.id')
            ->get()
            ->groupBy('plan_id');
        foreach ($plans as $plan) {
            $plan->channel_visibilities = ($rows->get($plan->id) ?: collect())->map(fn($row) => [
                'id' => (int)$row->id,
                'channel_type' => (string)$row->channel_type,
                'channel_key' => (string)$row->channel_key,
                'oem_project_key' => $row->oem_project_key,
                'oem_project_name' => $row->oem_project_name,
                'sort' => (int)$row->sort,
            ])->values();
        }
    }

    public function syncPlanVisibilities(int $planId, array $channelKeys): void
    {
        $clean = [];
        foreach ($channelKeys as $key) {
            $key = trim((string)$key);
            if ($key === '') {
                continue;
            }
            if ($key === 'default') {
                $clean[] = 'default';
                continue;
            }
            if (preg_match('/^[A-Za-z0-9_.-]{1,64}$/', $key) && $this->activeProjectExists($key)) {
                $clean[] = $key;
            }
        }
        $clean = array_values(array_unique($clean));
        DB::table('plan_channel_visibilities')->where('plan_id', $planId)->delete();
        $now = now();
        foreach ($clean as $idx => $key) {
            DB::table('plan_channel_visibilities')->insert([
                'plan_id' => $planId,
                'channel_type' => $key === 'default' ? 'default' : 'oem',
                'channel_key' => $key,
                'oem_project_key' => $key === 'default' ? null : $key,
                'sort' => $idx,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    public function commissionSnapshot(?string $oemProjectKey): array
    {
        if (!$oemProjectKey) {
            return [null, null, 0.0, 0.0, 'none'];
        }
        $project = DB::table('oem_projects')
            ->where('project_key', $oemProjectKey)
            ->whereNull('deleted_at')
            ->first();
        if (!$project || $project->status !== 'active' || empty($project->commission_enabled)) {
            return [$oemProjectKey, null, 0.0, 0.0, 'none'];
        }
        $member = DB::table('oem_project_members')
            ->where('oem_project_key', $oemProjectKey)
            ->where('status', 'active')
            ->orderByRaw("case role when 'owner' then 0 else 1 end")
            ->orderBy('id')
            ->first();
        $rate = max(0.0, min(1.0, (float)$project->commission_rate));
        if (!$member || $rate <= 0) {
            return [$oemProjectKey, $member?->user_id, $rate, 0.0, 'none'];
        }
        return [$oemProjectKey, (int)$member->user_id, $rate, 0.0, 'pending'];
    }

    public function attachOrderCommissionFields(array $payload, ?string $oemProjectKey): array
    {
        [$key, $userId, $rate, $amount, $status] = $this->commissionSnapshot($oemProjectKey);
        $payload['oem_project_key'] = $key;
        $payload['commission_user_id'] = $userId;
        $payload['commission_rate_snapshot'] = $rate;
        $payload['commission_amount'] = $amount;
        $payload['commission_status'] = $status;
        return $payload;
    }

    public function settleCommission(PaymentOrder $order): void
    {
        if (!$order->oem_project_key || !$order->commission_user_id || (float)$order->commission_rate_snapshot <= 0) {
            if ($order->commission_status !== 'none') {
                $order->commission_status = 'none';
                $order->commission_amount = '0.00';
                $order->save();
            }
            return;
        }
        $amount = round((float)$order->amount * (float)$order->commission_rate_snapshot, 2);
        $order->commission_amount = number_format($amount, 2, '.', '');
        $order->commission_status = $amount > 0 ? OemCommissionRecord::STATUS_CONFIRMED : 'none';
        $order->save();
        if ($amount <= 0) {
            return;
        }
        OemCommissionRecord::updateOrCreate(
            ['order_id' => $order->id],
            [
                'order_no' => $order->order_no,
                'oem_project_key' => (string)$order->oem_project_key,
                'user_id' => (int)$order->commission_user_id,
                'buyer_user_id' => (int)$order->user_id,
                'plan_id' => $order->plan_id ? (int)$order->plan_id : null,
                'order_type' => (string)($order->order_type ?: PaymentOrder::TYPE_PURCHASE),
                'pay_channel' => (string)$order->channel,
                'order_amount' => (float)$order->amount,
                'commission_rate' => (float)$order->commission_rate_snapshot,
                'commission_amount' => $amount,
                'status' => OemCommissionRecord::STATUS_CONFIRMED,
                'confirmed_at' => $order->paid_at ?: now(),
                'cancelled_at' => null,
                'cancel_reason' => '',
            ]
        );
    }

    private function activeProjectExists(string $projectKey): bool
    {
        return DB::table('oem_projects')
            ->where('project_key', $projectKey)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->exists();
    }
}
