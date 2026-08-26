<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Models\UserBalance;
use App\Models\BalanceLog;
use App\Models\UserPlan;
use App\Services\BalanceService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

class BalanceController extends Controller
{
    public function index(Request $request)
    {
        $query = UserBalance::with('user:id,username,nickname');

        if ($request->filled('user_id')) {
            $query->where('user_id', $request->user_id);
        }
        if ($request->filled('balance_type')) {
            $query->where('balance_type', $request->balance_type);
        }

        $balances = $query->orderByDesc('id')->paginate($request->get('per_page', 50));
        return response()->json($balances);
    }

    public function recharge(Request $request)
    {
        // target：wallet=钱包余额（默认，历史行为不变）；plan_quota=计入套餐余量（需 user_plan_id）
        $validator = Validator::make($request->all(), [
            'user_id' => 'required|integer|exists:users,id',
            'balance_type' => 'required|in:token,credit',
            'amount' => 'required|numeric',
            'remark' => 'nullable|string|max:500',
            'target' => 'nullable|in:wallet,plan_quota',
            'user_plan_id' => 'nullable|integer',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $target = $request->input('target', 'wallet');

        if ($target === 'plan_quota') {
            // 计入套餐余量：只支持正数（追加 adjust 桶）；负数请走钱包充值扣除
            if ((float)$request->amount <= 0) {
                return response()->json(['error' => '计入套餐余量只支持正数；扣减请充入钱包余额（负数）'], 422);
            }
            $userPlan = UserPlan::find($request->user_plan_id);
            if (!$userPlan || (int)$userPlan->user_id !== (int)$request->user_id) {
                return response()->json(['error' => '未找到该用户名下的套餐，请刷新后重新选择'], 422);
            }
            if ($userPlan->status !== 'active') {
                return response()->json(['error' => '该套餐当前不是生效状态，无法计入套餐余量'], 422);
            }
            if ($userPlan->expires_at && $userPlan->expires_at->lte(now())) {
                return response()->json(['error' => '该套餐已到期，无法计入套餐余量'], 422);
            }

            return DB::transaction(function () use ($request, $userPlan) {
                // 行锁防并发重复追加（同一请求连点两次）
                $locked = UserPlan::lockForUpdate()->find($userPlan->id);
                if (!$locked || $locked->status !== 'active') {
                    return response()->json(['error' => '该套餐当前不是生效状态，无法计入套餐余量'], 422);
                }
                $quota = app(BalanceService::class)->adjustPlanQuota(
                    $locked,
                    (string)$request->balance_type,
                    (float)$request->amount,
                    $request->remark ?? '',
                    auth()->id()
                );
                return response()->json([
                    'quota_id' => $quota->id,
                    'message' => '已计入套餐余量',
                ]);
            });
        }

        return DB::transaction(function () use ($request) {
            $balance = UserBalance::lockForUpdate()
                ->where('user_id', $request->user_id)
                ->where('balance_type', $request->balance_type)
                ->first();

            if (!$balance) {
                $balance = UserBalance::create([
                    'user_id' => $request->user_id,
                    'balance_type' => $request->balance_type,
                    'amount' => 0,
                ]);
                $balance = UserBalance::lockForUpdate()->find($balance->id);
            }

            $balance->amount = (float)$balance->amount + (float)$request->amount;
            $balance->save();

            // balance_after 口径与 BalanceService::addWallet 统一为「总额」（钱包 + 套餐），
            // 与流水列表展示口径一致，避免同一页面两种口径并存引起误解
            $balanceAfter = app(BalanceService::class)->totalBalance((int)$request->user_id, (string)$request->balance_type);

            BalanceLog::create([
                'user_id' => $request->user_id,
                'balance_type' => $request->balance_type,
                'change_amount' => $request->amount,
                'balance_after' => $balanceAfter,
                'change_type' => $request->amount >= 0 ? 'recharge' : 'deduct',
                'remark' => $request->remark ?? '',
                'operator_id' => auth()->id(),
            ]);

            return response()->json([
                'balance' => (float)$balance->amount,
                'message' => 'Balance updated',
            ]);
        });
    }

    public function batchRecharge(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'user_ids' => 'required|array|min:1',
            'user_ids.*' => 'integer|exists:users,id',
            'balance_type' => 'required|in:token,credit',
            'amount' => 'required|numeric',
            'remark' => 'nullable|string|max:500',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $results = [];

        DB::transaction(function () use ($request, &$results) {
            foreach ($request->user_ids as $userId) {
                $balance = UserBalance::lockForUpdate()
                    ->where('user_id', $userId)
                    ->where('balance_type', $request->balance_type)
                    ->first();

                if (!$balance) {
                    $balance = UserBalance::create([
                        'user_id' => $userId,
                        'balance_type' => $request->balance_type,
                        'amount' => 0,
                    ]);
                    $balance = UserBalance::lockForUpdate()->find($balance->id);
                }

                $balance->amount = (float)$balance->amount + (float)$request->amount;
                $balance->save();

                // balance_after 与单笔充值 / addWallet 同口径（总额），避免流水列表口径跳变
                $balanceAfter = app(BalanceService::class)->totalBalance((int)$userId, (string)$request->balance_type);

                BalanceLog::create([
                    'user_id' => $userId,
                    'balance_type' => $request->balance_type,
                    'change_amount' => $request->amount,
                    'balance_after' => $balanceAfter,
                    'change_type' => $request->amount >= 0 ? 'recharge' : 'deduct',
                    'remark' => $request->remark ?? '',
                    'operator_id' => auth()->id(),
                ]);

                $results[] = ['user_id' => $userId, 'balance' => (float)$balance->amount];
            }
        });

        return response()->json(['results' => $results]);
    }
}
