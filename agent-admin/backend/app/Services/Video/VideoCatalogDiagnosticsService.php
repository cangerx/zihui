<?php

namespace App\Services\Video;

use App\Models\User;
use App\Models\VideoModelSpec;
use App\Models\VideoProviderAccount;
use App\Models\VideoSkuPrice;
use Illuminate\Support\Collection;

class VideoCatalogDiagnosticsService
{
    private const REASON_PRIORITY = [
        'no_account',
        'account_inactive',
        'model_disabled',
        'sku_missing',
        'sku_disabled',
        'unpriced',
        'visible',
    ];

    public const REASON_LABELS = [
        'visible' => '桌面可见',
        'no_account' => '未配置服务商账号',
        'account_inactive' => '服务商账号未启用或缺少 API Key',
        'model_disabled' => '模型未启用',
        'sku_missing' => '尚未配置 SKU',
        'sku_disabled' => 'SKU 未启用',
        'unpriced' => 'SKU 尚未定价',
    ];

    /**
     * 返回管理端诊断数据。基本单元为 SKU，无 SKU 的模型会生成一条占位诊断。
     */
    public function diagnose(?User $user = null): array
    {
        [$models, $accountsByProvider] = $this->loadSnapshot();

        return [
            'reason_labels' => self::REASON_LABELS,
            'models' => $models->map(function (VideoModelSpec $model) use ($accountsByProvider, $user) {
                $skuRows = $model->skus->isEmpty()
                    ? [$this->diagnoseSku($model, null, $accountsByProvider, $user)]
                    : $model->skus->map(fn(VideoSkuPrice $sku) => $this->diagnoseSku($model, $sku, $accountsByProvider, $user))->values()->all();
                $visible = collect($skuRows)->contains(fn(array $row) => $row['visible']);
                $reasons = array_values(array_filter(
                    self::REASON_PRIORITY,
                    fn(string $reason) => collect($skuRows)->contains(fn(array $row) => in_array($reason, $row['reasons'], true))
                ));

                return [
                    'id' => (int) $model->id,
                    'provider_key' => $model->provider_key,
                    'provider_protocol' => $model->provider_protocol,
                    'model_id' => $model->model_id,
                    'display_name' => $model->display_name,
                    'status' => $model->status,
                    'visible' => $visible,
                    'reason' => $visible ? 'visible' : ($reasons[0] ?? 'sku_missing'),
                    'reasons' => $visible ? ['visible'] : $reasons,
                    'skus' => $skuRows,
                ];
            })->values()->all(),
        ];
    }

    /** @return Collection<int, VideoSkuPrice> */
    public function visibleSkus(): Collection
    {
        [$models, $accountsByProvider] = $this->loadSnapshot();

        return $models
            ->flatMap(fn(VideoModelSpec $model) => $model->skus->filter(
                fn(VideoSkuPrice $sku) => $this->diagnoseSku($model, $sku, $accountsByProvider, null)['visible']
            ))
            ->sortBy([['sort_order', 'asc'], ['id', 'asc']])
            ->values();
    }

    private function loadSnapshot(): array
    {
        $models = VideoModelSpec::with(['skus' => fn($query) => $query->orderBy('sort_order')->orderBy('id')])
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();
        $accountsByProvider = VideoProviderAccount::query()
            ->get(['provider_key', 'name', 'status', 'api_key'])
            ->groupBy('provider_key');

        return [$models, $accountsByProvider];
    }

    private function diagnoseSku(VideoModelSpec $model, ?VideoSkuPrice $sku, Collection $accountsByProvider, ?User $user): array
    {
        $providerKey = $sku?->provider_key ?: $model->provider_key;
        $accounts = $accountsByProvider->get($providerKey, collect());
        $hasUsableAccount = $accounts->contains(fn(VideoProviderAccount $account) =>
            $account->status === 'active' && trim((string) $account->api_key) !== ''
        );

        $reasons = [];
        if ($accounts->isEmpty()) {
            $reasons[] = 'no_account';
        } elseif (!$hasUsableAccount) {
            $reasons[] = 'account_inactive';
        }
        if ($model->status !== 'active') $reasons[] = 'model_disabled';
        if (!$sku) {
            $reasons[] = 'sku_missing';
        } else {
            if ($sku->status !== 'active') $reasons[] = 'sku_disabled';
            if ($sku->default_credit_cost === null) $reasons[] = 'unpriced';
        }

        $visible = empty($reasons);
        $billing = null;
        if ($sku && $sku->default_credit_cost !== null) {
            $billing = $user
                ? app(VideoBillingContextService::class)->resolve($user, $sku)
                : ['credit_cost' => (float) $sku->default_credit_cost, 'price_label' => $sku->price_label];
        }

        return [
            'id' => $sku ? (int) $sku->id : null,
            'sku_key' => $sku?->sku_key,
            'title' => $sku?->title,
            'status' => $sku?->status,
            'mode' => $sku?->mode,
            'duration_seconds' => $sku ? (int) $sku->duration_seconds : null,
            'resolution' => $sku?->resolution,
            'aspect_ratio' => $sku?->aspect_ratio,
            'quality' => $sku?->quality,
            'default_credit_cost' => $sku?->default_credit_cost,
            'credit_cost' => $billing['credit_cost'] ?? null,
            'price_label' => $billing['price_label'] ?? '',
            'pricing_target_type' => $billing['pricing_target_type'] ?? null,
            'visible' => $visible,
            'reason' => $visible ? 'visible' : $reasons[0],
            'reasons' => $visible ? ['visible'] : $reasons,
        ];
    }
}
