<?php

namespace App\Services;

use App\Models\PaymentOrder;
use App\Models\RechargePackage;
use App\Models\SystemSetting;
use App\Models\User;

/**
 * 直充（用户自助按金额充值金币/积分）。
 *
 * 两种形态：
 *   - 自由金额：按比例（1 元 = N）到账 + 阶梯赠送（满 X 送 Y）
 *   - 快捷档位：recharge_packages 表预设（充 X 送 Y）
 *
 * 到账明细在下单时由 quote() 固化进订单 plan_snapshot，履约只读快照、不重算。
 * 本金与赠送都进钱包（UserBalance，永久有效）。
 */
class RechargeService
{
    public function isEnabled(): bool
    {
        return (bool) SystemSetting::getValue('recharge_enabled', false);
    }

    public function getConfig(): array
    {
        return [
            'enabled' => $this->isEnabled(),
            'min_amount' => (float) SystemSetting::getValue('recharge_min_amount', 1),
            'token' => [
                'enabled' => $this->typeEnabled('token'),
                'ratio' => (float) SystemSetting::getValue('recharge_token_ratio', 1),
                'bonus_rules' => $this->bonusRules('token'),
            ],
            'credit' => [
                'enabled' => $this->typeEnabled('credit'),
                'ratio' => (float) SystemSetting::getValue('recharge_credit_ratio', 1),
                'bonus_rules' => $this->bonusRules('credit'),
            ],
            'packages' => $this->packages(),
        ];
    }

    /**
     * 某一充值类型（token/credit）是否对用户开放。默认开启，保持升级前行为。
     */
    public function typeEnabled(string $type): bool
    {
        $key = $type === 'token' ? 'recharge_token_enabled' : 'recharge_credit_enabled';
        return (bool) SystemSetting::getValue($key, true);
    }

    /**
     * @return array<int, array{threshold:float, bonus:float}>
     */
    public function bonusRules(string $type): array
    {
        $key = $type === 'token' ? 'recharge_token_bonus_rules' : 'recharge_credit_bonus_rules';
        $arr = json_decode((string) SystemSetting::getValue($key, ''), true);
        if (!is_array($arr)) {
            return [];
        }
        $rules = [];
        foreach ($arr as $r) {
            if (!is_array($r)) {
                continue;
            }
            $threshold = (float) ($r['threshold'] ?? 0);
            $bonus = (float) ($r['bonus'] ?? 0);
            if ($threshold > 0 && $bonus > 0) {
                $rules[] = ['threshold' => $threshold, 'bonus' => $bonus];
            }
        }
        usort($rules, fn($a, $b) => $a['threshold'] <=> $b['threshold']);
        return $rules;
    }

    public function packages(bool $activeOnly = false): array
    {
        $query = RechargePackage::query();
        if ($activeOnly) {
            $query->where('status', 'active');
        }
        return $query->orderBy('balance_type')->orderBy('sort')->orderBy('id')->get()->map(fn($p) => [
            'id' => (int) $p->id,
            'balance_type' => $p->balance_type,
            'pay_amount' => (float) $p->pay_amount,
            'base_amount' => (float) $p->base_amount,
            'bonus_amount' => (float) $p->bonus_amount,
            'total_amount' => (float) $p->base_amount + (float) $p->bonus_amount,
            'title' => $p->title,
            'status' => $p->status,
            'sort' => (int) $p->sort,
        ])->all();
    }

    /**
     * 计算到账明细（下单时调用，结果写进 snapshot）。
     *
     * @return array{balance_type:string, pay_amount:float, base_amount:float, bonus_amount:float, total_amount:float, package_id:?int}
     */
    public function quote(string $balanceType, ?float $amount = null, ?int $packageId = null): array
    {
        if (!$this->isEnabled()) {
            throw new \InvalidArgumentException('直充功能未开启');
        }
        if (!in_array($balanceType, ['token', 'credit'], true)) {
            throw new \InvalidArgumentException('余额类型不支持');
        }
        if (!$this->typeEnabled($balanceType)) {
            $label = (string) SystemSetting::getValue(
                $balanceType === 'token' ? 'currency_label_token' : 'currency_label_credit',
                $balanceType === 'token' ? '金币' : '积分'
            );
            throw new \InvalidArgumentException($label . '充值未开启');
        }

        if ($packageId) {
            $pkg = RechargePackage::where('id', $packageId)->where('status', 'active')->first();
            if (!$pkg) {
                throw new \InvalidArgumentException('充值档位不存在或已下架');
            }
            if ((string) $pkg->balance_type !== $balanceType) {
                throw new \InvalidArgumentException('充值档位与所选类型不一致');
            }
            $pay = round((float) $pkg->pay_amount, 2);
            if ($pay <= 0) {
                throw new \InvalidArgumentException('充值档位金额无效');
            }
            $base = (float) $pkg->base_amount;
            $bonus = (float) $pkg->bonus_amount;

            return [
                'balance_type' => $balanceType,
                'pay_amount' => $pay,
                'base_amount' => $base,
                'bonus_amount' => $bonus,
                'total_amount' => $base + $bonus,
                'package_id' => (int) $pkg->id,
            ];
        }

        $pay = round((float) $amount, 2);
        if ($pay <= 0) {
            throw new \InvalidArgumentException('充值金额无效');
        }
        $min = (float) SystemSetting::getValue('recharge_min_amount', 1);
        if ($pay + 1e-9 < $min) {
            throw new \InvalidArgumentException('低于起充金额（' . $this->trimNumber($min) . ' 元）');
        }
        $ratio = (float) SystemSetting::getValue($balanceType === 'token' ? 'recharge_token_ratio' : 'recharge_credit_ratio', 1);
        if ($ratio <= 0) {
            throw new \InvalidArgumentException('充值比例未配置');
        }
        $base = floor($pay * $ratio * 10000) / 10000;
        $bonus = $this->calcBonus($balanceType, $pay);

        return [
            'balance_type' => $balanceType,
            'pay_amount' => $pay,
            'base_amount' => $base,
            'bonus_amount' => $bonus,
            'total_amount' => $base + $bonus,
            'package_id' => null,
        ];
    }

    public function buildSnapshot(array $quote): array
    {
        return [
            'kind' => 'recharge',
            'balance_type' => $quote['balance_type'],
            'pay_amount' => $quote['pay_amount'],
            'base_amount' => $quote['base_amount'],
            'bonus_amount' => $quote['bonus_amount'],
            'total_amount' => $quote['total_amount'],
            'package_id' => $quote['package_id'],
        ];
    }

    /**
     * 履约入账：本金 + 赠送都进钱包（永久），分两笔流水便于对账。
     */
    public function fulfill(PaymentOrder $order, User $user, string $remarkPrefix = '[recharge]'): void
    {
        $snap = (array) $order->plan_snapshot;
        $type = (string) ($snap['balance_type'] ?? 'credit');
        if (!in_array($type, ['token', 'credit'], true)) {
            $type = 'credit';
        }
        $base = (float) ($snap['base_amount'] ?? 0);
        $bonus = (float) ($snap['bonus_amount'] ?? 0);

        $balanceService = app(BalanceService::class);
        if ($base > 0) {
            $balanceService->addWallet((int) $user->id, $type, $base, 'recharge', sprintf('%s %s 充值到账', $remarkPrefix, $order->order_no), null, (string) $order->order_no);
        }
        if ($bonus > 0) {
            $balanceService->addWallet((int) $user->id, $type, $bonus, 'recharge_bonus', sprintf('%s %s 充值赠送', $remarkPrefix, $order->order_no), null, (string) $order->order_no . '-bonus');
        }
    }

    private function calcBonus(string $type, float $payAmount): float
    {
        $bonus = 0.0;
        foreach ($this->bonusRules($type) as $rule) {
            if ($payAmount + 1e-9 >= $rule['threshold']) {
                $bonus = $rule['bonus'];
            }
        }
        return $bonus;
    }

    private function trimNumber(float $value): string
    {
        $str = number_format($value, 2, '.', '');
        return rtrim(rtrim($str, '0'), '.');
    }
}
