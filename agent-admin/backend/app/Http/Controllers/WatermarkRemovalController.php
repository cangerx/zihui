<?php

namespace App\Http\Controllers;

use App\Models\AiMarkRemovalRecord;
use App\Models\SystemSetting;
use App\Services\BalanceService;
use App\Services\QuotaService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * 去AI标记（本地清除元数据/溯源标识，按次计费）。
 *
 * 桌面端在本地完成剥离后调用 charge 扣费并记一次用量。
 * 设计要点：
 *  - 「成功后扣费」：本地处理成功才回调，规避失败扣费；
 *  - request_id 幂等：先入库占位（unique 索引）再扣费，同一事务，
 *    并发/重试都不会重复扣，扣费失败则整体回滚不留孤儿记录；
 *  - 单价优先级：policies 覆盖 > SystemSetting 全局价（照抄抠图 mattingCreditPerCall）。
 */
class WatermarkRemovalController extends Controller
{
    public function charge(Request $request)
    {
        $user = auth()->user();
        if (!$user) {
            return response()->json(['error' => '未登录'], 401);
        }

        // 1. 全局总开关
        if (!SystemSetting::getValue('ai_mark_removal_enabled', false)) {
            return response()->json(['error' => '去AI标记服务未启用'], 503);
        }

        // 2. 使用门控：全局可用开关开 → 所有人可用；否则需按用户/分组/套餐授权 allow_ai_mark_removal
        $perms = app(QuotaService::class)->policies($user);
        $useAll = (bool) SystemSetting::getValue('ai_mark_removal_use_all', false);
        if (!$useAll && !($perms['allow_ai_mark_removal'] ?? false)) {
            return response()->json(['error' => '当前账号未开通去AI标记功能'], 403);
        }

        // 3. 参数
        $requestId = trim((string) $request->input('request_id', ''));
        if ($requestId === '') {
            $requestId = (string) Str::uuid();
        }
        // request_id 列长 100，截断防止超长客户端输入触发 insert 异常
        if (mb_strlen($requestId) > 100) {
            $requestId = mb_substr($requestId, 0, 100);
        }
        $marks = (string) $request->input('marks', '');
        if (mb_strlen($marks) > 500) {
            $marks = mb_substr($marks, 0, 500);
        }
        $imageCount = max(1, (int) $request->input('image_count', 1));

        // 4. 幂等：同一 request_id 已扣过直接返回原结果
        $existing = AiMarkRemovalRecord::where('request_id', $requestId)->first();
        if ($existing) {
            return response()->json([
                'charged'   => true,
                'cost'      => (float) $existing->cost,
                'duplicate' => true,
            ]);
        }

        // 5. 单价 × 张数
        $needed = round($this->creditPerCall($perms) * $imageCount, 4);

        // 6. 余额校验（免费用户 needed=0 直接放行）
        if ($needed > 0) {
            $balance = app(BalanceService::class)->totalBalance($user->id, 'credit');
            if ($balance < $needed) {
                return response()->json([
                    'error'   => '积分余额不足，本次需 ' . round($needed, 4) . '，当前 ' . round($balance, 4) . '，请充值后重试',
                    'needed'  => $needed,
                    'current' => $balance,
                ], 402);
            }
        }

        // 7. 先占位入库（unique 幂等）再扣费，同一事务：并发重复只成一次，扣费失败整体回滚
        try {
            DB::transaction(function () use ($user, $needed, $marks, $imageCount, $requestId) {
                AiMarkRemovalRecord::create([
                    'user_id'      => $user->id,
                    'cost'         => $needed,
                    'balance_type' => 'credit',
                    'marks'        => $marks,
                    'image_count'  => $imageCount,
                    'status'       => 'success',
                    'request_id'   => $requestId,
                ]);
                if ($needed > 0) {
                    app(BalanceService::class)->deduct(
                        $user, 'credit', $needed, 'usage', '去AI标记 ' . $requestId, $requestId
                    );
                }
            });
        } catch (\Illuminate\Database\QueryException $e) {
            // request_id unique 冲突 = 并发下另一个请求已扣，视为成功幂等
            $dup = AiMarkRemovalRecord::where('request_id', $requestId)->first();
            if ($dup) {
                return response()->json(['charged' => true, 'cost' => (float) $dup->cost, 'duplicate' => true]);
            }
            Log::error('[WatermarkRemovalController.charge] DB: ' . $e->getMessage());
            return response()->json(['error' => '扣费失败，请重试'], 500);
        } catch (\Throwable $e) {
            // 扣费异常（余额不足等）事务已回滚，不留记录
            Log::warning('[WatermarkRemovalController.charge] ' . $e->getMessage());
            return response()->json(['error' => '扣费失败：积分不足或系统繁忙'], 402);
        }

        return response()->json([
            'charged' => true,
            'cost'    => $needed,
            'balance' => app(BalanceService::class)->totalBalance($user->id, 'credit'),
        ]);
    }

    /**
     * 单次去标记单价：policies 覆盖优先，回退 SystemSetting 全局价。
     */
    private function creditPerCall(array $perms): float
    {
        if (isset($perms['ai_mark_removal_credit_per_call']) && is_numeric($perms['ai_mark_removal_credit_per_call'])) {
            return max(0, (float) $perms['ai_mark_removal_credit_per_call']);
        }
        return max(0, (float) SystemSetting::getValue('ai_mark_removal_credit_per_call', 0.1));
    }
}
