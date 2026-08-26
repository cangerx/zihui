<?php

namespace Tests\Unit;

use App\Services\Packaging\PackagingLicenseQuote;
use PHPUnit\Framework\TestCase;

class PackagingLicenseQuoteTest extends TestCase
{
    public function test_disabled_self_serve_rejects(): void
    {
        $q = PackagingLicenseQuote::quote($this->flags(), ['win'], 100, 80, false);
        $this->assertFalse($q['ok']);
        $this->assertSame('self_serve_disabled', $q['error']);
    }

    public function test_zero_price_rejects(): void
    {
        $q = PackagingLicenseQuote::quote($this->flags(), ['win'], 0, 80, true);
        $this->assertFalse($q['ok']);
        $this->assertSame('price_zero', $q['error']);
    }

    public function test_mac_requires_win_when_win_not_open(): void
    {
        $q = PackagingLicenseQuote::quote($this->flags(), ['mac'], 100, 80, true);
        $this->assertFalse($q['ok']);
        $this->assertSame('mac_requires_win', $q['error']);
    }

    public function test_mac_plus_win_sums_prices(): void
    {
        $q = PackagingLicenseQuote::quote($this->flags(), ['mac', 'win'], 100, 80, true);
        $this->assertTrue($q['ok']);
        $this->assertSame(['win', 'mac'], $q['features']);
        $this->assertSame(180, $q['amount']);
    }

    public function test_already_authorized_rejects(): void
    {
        $q = PackagingLicenseQuote::quote($this->flags(true, true), ['win', 'mac'], 100, 80, true);
        $this->assertFalse($q['ok']);
        $this->assertSame('already_authorized', $q['error']);
    }

    public function test_only_charges_unopened_features(): void
    {
        $q = PackagingLicenseQuote::quote($this->flags(true, false), ['win', 'mac'], 100, 80, true);
        $this->assertTrue($q['ok']);
        $this->assertSame(['mac'], $q['features']);
        $this->assertSame(80, $q['amount']);
    }

    /**
     * @return array{can_use_github_packaging:bool,can_use_mac_packaging:bool}
     */
    private function flags(bool $win = false, bool $mac = false): array
    {
        return [
            'can_use_github_packaging' => $win,
            'can_use_mac_packaging' => $mac,
        ];
    }
}
