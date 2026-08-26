<?php

namespace App\Http\Controllers;

use App\Models\RechargePackage;
use App\Models\SystemSetting;
use App\Services\RechargeService;
use Illuminate\Http\Request;

class RechargeController extends Controller
{
    // ===== Client =====

    /**
     * 桌面端拉取直充配置：开关 / 起充 / 两种比例 / 阶梯赠送 / 启用中的快捷档位。
     */
    public function clientConfig(RechargeService $service)
    {
        $cfg = $service->getConfig();
        $cfg['packages'] = array_values(array_filter($cfg['packages'], fn($p) => $p['status'] === 'active'));
        $cfg['labels'] = [
            'token' => (string) SystemSetting::getValue('currency_label_token', '金币'),
            'credit' => (string) SystemSetting::getValue('currency_label_credit', '积分'),
        ];
        return response()->json($cfg);
    }

    // ===== Admin =====

    public function adminConfig(RechargeService $service)
    {
        return response()->json([
            'enabled' => (bool) SystemSetting::getValue('recharge_enabled', false),
            'min_amount' => (float) SystemSetting::getValue('recharge_min_amount', 1),
            'token_enabled' => $service->typeEnabled('token'),
            'credit_enabled' => $service->typeEnabled('credit'),
            'token_ratio' => (float) SystemSetting::getValue('recharge_token_ratio', 1),
            'credit_ratio' => (float) SystemSetting::getValue('recharge_credit_ratio', 1),
            'token_bonus_rules' => $service->bonusRules('token'),
            'credit_bonus_rules' => $service->bonusRules('credit'),
            'packages' => $service->packages(),
        ]);
    }

    public function adminUpdateConfig(Request $request)
    {
        $payload = $request->validate([
            'enabled' => 'nullable|boolean',
            'token_enabled' => 'nullable|boolean',
            'credit_enabled' => 'nullable|boolean',
            'min_amount' => 'nullable|numeric|min:0|max:100000',
            'token_ratio' => 'nullable|numeric|min:0|max:1000000',
            'credit_ratio' => 'nullable|numeric|min:0|max:1000000',
            'token_bonus_rules' => 'nullable|array',
            'token_bonus_rules.*.threshold' => 'required_with:token_bonus_rules|numeric|min:0',
            'token_bonus_rules.*.bonus' => 'required_with:token_bonus_rules|numeric|min:0',
            'credit_bonus_rules' => 'nullable|array',
            'credit_bonus_rules.*.threshold' => 'required_with:credit_bonus_rules|numeric|min:0',
            'credit_bonus_rules.*.bonus' => 'required_with:credit_bonus_rules|numeric|min:0',
        ]);

        if (array_key_exists('enabled', $payload)) {
            SystemSetting::setValue('recharge_enabled', (bool) $payload['enabled']);
        }
        if (array_key_exists('token_enabled', $payload)) {
            SystemSetting::setValue('recharge_token_enabled', (bool) $payload['token_enabled']);
        }
        if (array_key_exists('credit_enabled', $payload)) {
            SystemSetting::setValue('recharge_credit_enabled', (bool) $payload['credit_enabled']);
        }
        if (array_key_exists('min_amount', $payload) && $payload['min_amount'] !== null) {
            SystemSetting::setValue('recharge_min_amount', (float) $payload['min_amount']);
        }
        if (array_key_exists('token_ratio', $payload) && $payload['token_ratio'] !== null) {
            SystemSetting::setValue('recharge_token_ratio', (float) $payload['token_ratio']);
        }
        if (array_key_exists('credit_ratio', $payload) && $payload['credit_ratio'] !== null) {
            SystemSetting::setValue('recharge_credit_ratio', (float) $payload['credit_ratio']);
        }
        if (array_key_exists('token_bonus_rules', $payload)) {
            SystemSetting::setValue('recharge_token_bonus_rules', json_encode($this->cleanRules($payload['token_bonus_rules'] ?? []), JSON_UNESCAPED_UNICODE));
        }
        if (array_key_exists('credit_bonus_rules', $payload)) {
            SystemSetting::setValue('recharge_credit_bonus_rules', json_encode($this->cleanRules($payload['credit_bonus_rules'] ?? []), JSON_UNESCAPED_UNICODE));
        }

        return response()->json(['ok' => true]);
    }

    public function adminPackages(RechargeService $service)
    {
        return response()->json(['packages' => $service->packages()]);
    }

    public function adminStorePackage(Request $request)
    {
        $data = $request->validate([
            'balance_type' => 'required|in:token,credit',
            'pay_amount' => 'required|numeric|min:0.01|max:100000',
            'base_amount' => 'required|numeric|min:0|max:100000000',
            'bonus_amount' => 'nullable|numeric|min:0|max:100000000',
            'title' => 'nullable|string|max:100',
            'status' => 'nullable|in:active,disabled',
            'sort' => 'nullable|integer|min:0|max:999999',
        ]);
        $pkg = RechargePackage::create([
            'balance_type' => $data['balance_type'],
            'pay_amount' => $data['pay_amount'],
            'base_amount' => $data['base_amount'],
            'bonus_amount' => $data['bonus_amount'] ?? 0,
            'title' => $data['title'] ?? '',
            'status' => $data['status'] ?? 'active',
            'sort' => $data['sort'] ?? 0,
        ]);
        return response()->json(['package' => $pkg]);
    }

    public function adminUpdatePackage(Request $request, int $id)
    {
        $pkg = RechargePackage::findOrFail($id);
        $data = $request->validate([
            'balance_type' => 'nullable|in:token,credit',
            'pay_amount' => 'nullable|numeric|min:0.01|max:100000',
            'base_amount' => 'nullable|numeric|min:0|max:100000000',
            'bonus_amount' => 'nullable|numeric|min:0|max:100000000',
            'title' => 'nullable|string|max:100',
            'status' => 'nullable|in:active,disabled',
            'sort' => 'nullable|integer|min:0|max:999999',
        ]);
        $update = [];
        foreach ($data as $key => $value) {
            if ($value !== null) {
                $update[$key] = $value;
            }
        }
        $pkg->update($update);
        return response()->json(['package' => $pkg->fresh()]);
    }

    public function adminDeletePackage(int $id)
    {
        RechargePackage::findOrFail($id)->delete();
        return response()->json(['ok' => true]);
    }

    private function cleanRules($rules): array
    {
        $out = [];
        foreach ((array) $rules as $r) {
            if (!is_array($r)) {
                continue;
            }
            $threshold = (float) ($r['threshold'] ?? 0);
            $bonus = (float) ($r['bonus'] ?? 0);
            if ($threshold > 0 && $bonus > 0) {
                $out[] = ['threshold' => $threshold, 'bonus' => $bonus];
            }
        }
        usort($out, fn($a, $b) => $a['threshold'] <=> $b['threshold']);
        return $out;
    }
}
