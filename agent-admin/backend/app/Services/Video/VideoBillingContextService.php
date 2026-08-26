<?php

namespace App\Services\Video;

use App\Models\VideoPricingRule;
use App\Models\VideoSkuPrice;
use App\Models\User;

class VideoBillingContextService
{
    public function resolve(User $user, VideoSkuPrice $sku): array
    {
        $defaultCost = $sku->default_credit_cost;
        $rule = $this->effectiveRule($user, $sku);
        $creditCost = $rule ? (float)$rule->credit_cost : (float)$defaultCost;
        $resolvedLabel = $creditCost > 0 ? rtrim(rtrim((string)$creditCost, '0'), '.') . '/次' : '免费';
        $priceLabel = $rule ? $resolvedLabel : ($sku->price_label ?: $resolvedLabel);

        return [
            'sku_key' => $sku->sku_key,
            'balance_type' => 'credit',
            'estimated_credits' => $creditCost,
            'credit_cost' => $creditCost,
            'price_label' => $priceLabel,
            'pricing_rule_id' => $rule?->id,
            'pricing_target_type' => $rule?->target_type ?? 'default',
            'pricing_target_id' => $rule?->target_id,
        ];
    }

    public function effectiveRule(User $user, VideoSkuPrice $sku): ?VideoPricingRule
    {
        $rule = VideoPricingRule::where('video_sku_price_id', $sku->id)
            ->where('target_type', 'user')
            ->where('target_id', $user->id)
            ->where('status', 'active')
            ->first();
        if ($rule) return $rule;

        $groupIds = $user->groups()->pluck('user_groups.id')->toArray();
        if (!empty($groupIds)) {
            $rule = VideoPricingRule::where('video_sku_price_id', $sku->id)
                ->where('target_type', 'group')
                ->whereIn('target_id', $groupIds)
                ->where('status', 'active')
                ->orderBy('credit_cost')
                ->first();
            if ($rule) return $rule;
        }

        return null;
    }
}
