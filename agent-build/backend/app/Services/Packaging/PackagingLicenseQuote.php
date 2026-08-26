<?php

namespace App\Services\Packaging;

/**
 * 自助购买计价与校验（纯函数，单测不依赖 Laravel）。
 */
class PackagingLicenseQuote
{
    public const FEATURE_WIN = 'win';
    public const FEATURE_MAC = 'mac';
    public const FEATURES = [self::FEATURE_WIN, self::FEATURE_MAC];

    /**
     * @param array{can_use_github_packaging?:bool,can_use_mac_packaging?:bool} $current
     * @param string[] $requested
     * @return array{ok:bool,error:?string,features:string[],amount:int}
     */
    public static function quote(
        array $current,
        array $requested,
        int $winPrice,
        int $macPrice,
        bool $selfServeEnabled
    ): array {
        $empty = ['ok' => false, 'error' => null, 'features' => [], 'amount' => 0];

        if (!$selfServeEnabled) {
            $empty['error'] = 'self_serve_disabled';
            return $empty;
        }

        $requested = array_values(array_unique(array_filter(
            $requested,
            fn ($k) => in_array($k, self::FEATURES, true)
        )));
        if ($requested === []) {
            $empty['error'] = 'features_required';
            return $empty;
        }

        $hasWin = (bool) ($current['can_use_github_packaging'] ?? false);
        $hasMac = (bool) ($current['can_use_mac_packaging'] ?? false);
        $wantsMac = in_array(self::FEATURE_MAC, $requested, true);
        $wantsWin = in_array(self::FEATURE_WIN, $requested, true);

        if ($wantsMac && !$hasWin && !$wantsWin) {
            $empty['error'] = 'mac_requires_win';
            return $empty;
        }

        $toGrant = [];
        if ($wantsWin && !$hasWin) {
            $toGrant[] = self::FEATURE_WIN;
        }
        if ($wantsMac && !$hasMac) {
            $toGrant[] = self::FEATURE_MAC;
        }
        if ($toGrant === []) {
            $empty['error'] = 'already_authorized';
            return $empty;
        }

        $amount = 0;
        foreach ($toGrant as $feature) {
            $price = $feature === self::FEATURE_MAC ? $macPrice : $winPrice;
            if ($price <= 0) {
                $empty['error'] = 'price_zero';
                return $empty;
            }
            $amount += $price;
        }

        return [
            'ok' => true,
            'error' => null,
            'features' => $toGrant,
            'amount' => $amount,
        ];
    }
}
