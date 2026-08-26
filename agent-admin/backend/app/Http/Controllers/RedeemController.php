<?php

namespace App\Http\Controllers;

use App\Models\Plan;
use App\Models\RedeemCode;
use App\Models\RedeemRecord;
use App\Services\BalanceService;
use App\Services\PlanService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class RedeemController extends Controller
{
    // ===== Admin: list codes =====
    public function index(Request $request)
    {
        $query = RedeemCode::query();

        if ($request->filled('status'))   $query->where('status', $request->status);
        if ($request->filled('type'))     $query->where('type', $request->type);
        if ($request->filled('batch_id')) $query->where('batch_id', $request->batch_id);
        if ($request->filled('code'))     $query->where('code', 'like', '%' . strtoupper($request->code) . '%');

        $data = $query->orderByDesc('id')->paginate($request->get('per_page', 50));
        return response()->json($data);
    }

    // ===== Admin: create a single code =====
    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'code'           => 'nullable|string|min:4|max:64',
            'type'           => 'required|in:balance,credit,plan,bundle',
            'reward'         => 'required|array',
            'max_uses'       => 'nullable|integer|min:0',
            'per_user_limit' => 'nullable|integer|min:0',
            'starts_at'      => 'nullable|date',
            'expires_at'     => 'nullable|date|after_or_equal:starts_at',
            'remark'         => 'nullable|string|max:500',
            'batch_id'       => 'nullable|string|max:64',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $reward = $this->normalizeReward($request->input('reward', []));
        if (!$this->validateReward($request->input('type'), $reward)) {
            return response()->json(['error' => 'reward invalid for type ' . $request->input('type')], 422);
        }

        $code = $request->filled('code')
            ? strtoupper(trim((string)$request->input('code')))
            : $this->generateUniqueCode(12);

        if (RedeemCode::where('code', $code)->exists()) {
            return response()->json(['error' => 'code already exists'], 409);
        }

        $model = RedeemCode::create([
            'code'           => $code,
            'type'           => $request->input('type'),
            'reward_json'    => $reward,
            'max_uses'       => $this->intInput($request, 'max_uses', 1),
            'per_user_limit' => $this->intInput($request, 'per_user_limit', 1),
            'starts_at'      => $request->input('starts_at'),
            'expires_at'     => $request->input('expires_at'),
            'status'         => 'active',
            'batch_id'       => $request->input('batch_id'),
            'remark'         => (string)$request->input('remark', ''),
            'created_by'     => auth()->id(),
        ]);

        return response()->json(['code' => $model], 201);
    }

    // ===== Admin: batch generate =====
    public function batchGenerate(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'count'          => 'required|integer|min:1|max:10000',
            'prefix'         => 'nullable|string|max:16',
            'length'         => 'nullable|integer|min:4|max:32',
            'type'           => 'required|in:balance,credit,plan,bundle',
            'reward'         => 'required|array',
            'max_uses'       => 'nullable|integer|min:0',
            'per_user_limit' => 'nullable|integer|min:0',
            'starts_at'      => 'nullable|date',
            'expires_at'     => 'nullable|date|after_or_equal:starts_at',
            'remark'         => 'nullable|string|max:500',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $reward = $this->normalizeReward($request->input('reward', []));
        if (!$this->validateReward($request->input('type'), $reward)) {
            return response()->json(['error' => 'reward invalid for type ' . $request->input('type')], 422);
        }

        $count    = (int)$request->input('count');
        $prefix   = strtoupper((string)$request->input('prefix', ''));
        $length   = (int)$request->input('length', 12);
        $batchId  = 'B' . date('YmdHis') . strtoupper(substr(Str::random(4), 0, 4));
        $now      = now();
        $payload  = [
            'type'           => $request->input('type'),
            'reward_json'    => json_encode($reward),
            'max_uses'       => $this->intInput($request, 'max_uses', 1),
            'per_user_limit' => $this->intInput($request, 'per_user_limit', 1),
            'starts_at'      => $request->input('starts_at'),
            'expires_at'     => $request->input('expires_at'),
            'status'         => 'active',
            'batch_id'       => $batchId,
            'remark'         => (string)$request->input('remark', ''),
            'created_by'     => auth()->id(),
            'created_at'     => $now,
            'updated_at'     => $now,
        ];

        $inserted = 0;
        $codes    = [];
        $attempts = 0;
        $maxAttempts = $count * 5;

        while ($inserted < $count && $attempts < $maxAttempts) {
            $attempts++;
            $code = $this->generateCandidate($prefix, $length);
            try {
                DB::table('redeem_codes')->insert(array_merge($payload, ['code' => $code]));
                $codes[] = $code;
                $inserted++;
            } catch (\Illuminate\Database\QueryException $e) {
                // 仅捕获唯一键冲突 (SQLSTATE 23000)，其他异常应抛出
                if ((string)$e->getCode() !== '23000') throw $e;
                continue;
            }
        }

        return response()->json([
            'batch_id' => $batchId,
            'count'    => $inserted,
            'codes'    => $codes,
        ], 201);
    }

    // ===== Admin: update (limited fields) =====
    public function update(Request $request, $id)
    {
        $code = RedeemCode::findOrFail($id);

        $validator = Validator::make($request->all(), [
            'status'         => 'nullable|in:active,disabled',
            'max_uses'       => 'nullable|integer|min:0',
            'per_user_limit' => 'nullable|integer|min:0',
            'starts_at'      => 'nullable|date',
            'expires_at'     => 'nullable|date',
            'remark'         => 'nullable|string|max:500',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        foreach (['status', 'max_uses', 'per_user_limit', 'starts_at', 'expires_at', 'remark'] as $f) {
            if ($request->has($f)) {
                $code->$f = $request->input($f);
            }
        }
        $code->save();

        return response()->json(['code' => $code]);
    }

    // ===== Admin: delete =====
    public function destroy($id)
    {
        $code = RedeemCode::findOrFail($id);
        $code->delete();
        return response()->json(['message' => 'deleted']);
    }

    // ===== Admin: batch delete =====
    /** 批量删除：循环调用 destroy，收集 errors */
    public function batchDestroy(Request $request)
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', (array) $request->input('ids', [])))));
        if (empty($ids)) return response()->json(['error' => 'ids 不能为空'], 400);
        if (count($ids) > 200) return response()->json(['error' => '单次批量操作不超过 200 条'], 400);

        $deleted = 0; $errors = [];
        foreach ($ids as $id) {
            try {
                $resp = $this->destroy($id);
                if ($resp->getStatusCode() >= 400) {
                    $data = $resp->getData(true);
                    $errors[] = ['id' => $id, 'error' => $data['error'] ?? ('HTTP ' . $resp->getStatusCode())];
                    continue;
                }
                $deleted++;
            } catch (\Throwable $e) {
                $errors[] = ['id' => $id, 'error' => $e->getMessage()];
            }
        }
        return response()->json(['deleted' => $deleted, 'errors' => $errors, 'total' => count($ids)]);
    }

    // ===== Admin: list records =====
    public function records(Request $request)
    {
        $query = RedeemRecord::with(['code:id,code,type', 'user:id,username,nickname']);

        if ($request->filled('code_id')) $query->where('code_id', $request->code_id);
        if ($request->filled('user_id')) $query->where('user_id', $request->user_id);

        $data = $query->orderByDesc('id')->paginate($request->get('per_page', 50));
        return response()->json($data);
    }

    // ===== Client: redeem code =====
    public function redeem(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'code' => 'required|string|min:4|max:64',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $user    = auth()->user();
        $codeStr = strtoupper(trim((string)$request->input('code')));
        $now     = now();

        return DB::transaction(function () use ($user, $codeStr, $request, $now) {
            // Lock the code row
            $code = RedeemCode::where('code', $codeStr)->lockForUpdate()->first();

            if (!$code) {
                return response()->json(['error' => '兑换码不存在'], 404);
            }
            if ($code->status !== 'active') {
                return response()->json(['error' => '兑换码已禁用'], 400);
            }
            if ($code->starts_at && $code->starts_at->gt($now)) {
                return response()->json(['error' => '兑换码尚未生效'], 400);
            }
            if ($code->expires_at && $code->expires_at->lt($now)) {
                return response()->json(['error' => '兑换码已过期'], 400);
            }
            if ($code->max_uses > 0 && $code->used_count >= $code->max_uses) {
                return response()->json(['error' => '兑换码已被用完'], 400);
            }

            // Idempotency: same user same code
            $existingCount = RedeemRecord::where('code_id', $code->id)
                ->where('user_id', $user->id)
                ->count();
            if ($code->per_user_limit > 0 && $existingCount >= $code->per_user_limit) {
                return response()->json(['error' => '您已兑换过此兑换码'], 409);
            }

            $reward = is_array($code->reward_json) ? $code->reward_json : [];
            $tokenAmount  = (float)($reward['token'] ?? 0);
            $creditAmount = (float)($reward['credit'] ?? 0);
            $planId       = $reward['plan_id'] ?? null;

            $snapshot = [
                'type'    => $code->type,
                'reward'  => $reward,
                'granted' => ['token' => 0, 'credit' => 0, 'plan_id' => null, 'user_plan_id' => null],
            ];

            $logRemark = '[redeem] code=' . $code->code;

            if ($tokenAmount > 0) {
                app(BalanceService::class)->addWallet($user->id, 'token', $tokenAmount, 'redeem', $logRemark);
                $snapshot['granted']['token'] = $tokenAmount;
            }
            if ($creditAmount > 0) {
                app(BalanceService::class)->addWallet($user->id, 'credit', $creditAmount, 'redeem', $logRemark);
                $snapshot['granted']['credit'] = $creditAmount;
            }
            if ($planId) {
                $plan = Plan::find((int)$planId);
                if ($plan && $plan->status === 'active') {
                    $userPlan = app(PlanService::class)->grant($user, $plan, [
                        'source' => 'redeem',
                        'remark' => $logRemark,
                    ]);
                    $snapshot['granted']['plan_id']      = (int)$planId;
                    $snapshot['granted']['user_plan_id'] = $userPlan?->id;
                } else {
                    Log::warning("[redeem] plan #{$planId} missing or archived, skipped");
                    $snapshot['granted']['plan_id']       = (int)$planId;
                    $snapshot['granted']['plan_archived'] = true;
                }
            }

            // Record
            try {
                RedeemRecord::create([
                    'code_id'             => $code->id,
                    'user_id'             => $user->id,
                    'reward_snapshot_json'=> $snapshot,
                    'ip'                  => substr((string)$request->ip(), 0, 45),
                    'user_agent'          => substr((string)$request->userAgent(), 0, 255),
                    'created_at'          => $now,
                ]);
            } catch (\Illuminate\Database\QueryException $e) {
                // Duplicate guard: unique(code_id, user_id)
                if ((string)$e->getCode() === '23000') {
                    return response()->json(['error' => '您已兑换过此兑换码'], 409);
                }
                throw $e;
            }

            $code->used_count = (int)$code->used_count + 1;
            $code->save();

            return response()->json([
                'success' => true,
                'reward'  => $snapshot['granted'],
                'code'    => $code->code,
            ]);
        });
    }

    // ===== Helpers =====

    private function normalizeReward(array $input): array
    {
        return [
            'token'   => isset($input['token'])   ? (float)$input['token']   : 0,
            'credit'  => isset($input['credit'])  ? (float)$input['credit']  : 0,
            'plan_id' => isset($input['plan_id']) && $input['plan_id'] !== '' && $input['plan_id'] !== null
                ? (int)$input['plan_id']
                : null,
        ];
    }

    private function validateReward(string $type, array $reward): bool
    {
        $hasToken  = ($reward['token']   ?? 0) > 0;
        $hasCredit = ($reward['credit']  ?? 0) > 0;
        $hasPlan   = !empty($reward['plan_id']);

        switch ($type) {
            case 'balance': return $hasToken && !$hasCredit && !$hasPlan;
            case 'credit':  return !$hasToken && $hasCredit && !$hasPlan;
            case 'plan':    return !$hasToken && !$hasCredit && $hasPlan;
            case 'bundle':  return $hasToken || $hasCredit || $hasPlan;
        }
        return false;
    }

    private function intInput(Request $request, string $key, int $default): int
    {
        $value = $request->input($key, $default);
        return $value === null || $value === '' ? $default : (int) $value;
    }

    private function generateCandidate(string $prefix, int $length): string
    {
        $charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
        $body = '';
        $max = strlen($charset) - 1;
        for ($i = 0; $i < $length; $i++) {
            $body .= $charset[random_int(0, $max)];
        }
        return $prefix !== '' ? ($prefix . '-' . $body) : $body;
    }

    private function generateUniqueCode(int $length): string
    {
        for ($i = 0; $i < 10; $i++) {
            $c = $this->generateCandidate('', $length);
            if (!RedeemCode::where('code', $c)->exists()) return $c;
        }
        return 'R' . date('YmdHis') . strtoupper(Str::random(6));
    }

}
