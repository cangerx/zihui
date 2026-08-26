<?php

namespace App\Services\Packaging;

use App\Services\SystemSetting\SettingService;

/**
 * 打包授权单价与自助上架。价格不写死 PHP 常量。
 */
class PackagingLicenseSettings
{
    public const GROUP = 'packaging_license';

    public function __construct(private SettingService $settings)
    {
    }

    /**
     * @return array{win_price:int,mac_price:int,self_serve_enabled:bool}
     */
    public function snapshot(): array
    {
        $g = $this->settings->getGroup(self::GROUP);
        return [
            'win_price' => max(0, (int) ($g['win_price'] ?? 0)),
            'mac_price' => max(0, (int) ($g['mac_price'] ?? 0)),
            'self_serve_enabled' => (string) ($g['self_serve_enabled'] ?? '0') === '1',
        ];
    }

    /**
     * @param array{win_price?:int|string,mac_price?:int|string,self_serve_enabled?:bool|int|string} $input
     * @return array{win_price:int,mac_price:int,self_serve_enabled:bool}
     */
    public function save(array $input): array
    {
        $win = max(0, (int) ($input['win_price'] ?? 0));
        $mac = max(0, (int) ($input['mac_price'] ?? 0));
        $enabled = $this->asBool($input['self_serve_enabled'] ?? false);

        $this->settings->setGroup(self::GROUP, [
            'win_price' => (string) $win,
            'mac_price' => (string) $mac,
            'self_serve_enabled' => $enabled ? '1' : '0',
        ]);

        return $this->snapshot();
    }

    private function asBool(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (is_int($value)) {
            return $value === 1;
        }
        return in_array(strtolower((string) $value), ['1', 'true', 'yes', 'on'], true);
    }
}
