<?php

namespace App\Http\Controllers\App\V1;

use App\Models\Plan;
use App\Support\AppV1Response;
use Illuminate\Http\Request;

class BillingController
{
    public function plans()
    {
        $plans = Plan::query()->where('status', 'active')->orderBy('sort')->orderBy('id')->get()->map(fn ($plan) => [
            'id' => (int) $plan->id,
            'code' => (string) $plan->code,
            'name' => (string) $plan->name,
            'description' => (string) $plan->description,
            'price' => (float) $plan->price,
            'currency' => (string) $plan->currency,
            'duration_days' => (int) $plan->duration_days,
            'token_quota' => (float) $plan->token_quota,
            'credit_quota' => (float) $plan->credit_quota,
            'storage_quota_bytes' => (int) ($plan->storage_quota_bytes ?? 0),
        ])->values()->all();

        return AppV1Response::ok($plans);
    }

    public function balance(Request $request)
    {
        $user = $request->user();
        $balances = collect(['token', 'credit'])->map(function ($type) use ($user) {
            $wallet = (float) $user->balances()->where('balance_type', $type)->value('amount');
            $plan = (float) $user->planQuotas()->where('balance_type', $type)->where('status', 'active')
                ->where(function ($query) {
                    $query->whereNull('expires_at')->orWhere('expires_at', '>', now());
                })->get()->sum(fn ($quota) => max(0, (float) $quota->granted - (float) $quota->consumed));
            return ['type' => $type, 'wallet' => $wallet, 'plan' => $plan, 'total' => $wallet + $plan];
        })->all();

        return AppV1Response::ok($balances);
    }
}
