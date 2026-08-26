<?php

namespace App\Http\Controllers;

use App\Models\PaymentOrder;
use App\Models\Plan;
use App\Models\UserPlan;
use App\Services\OemChannelService;
use App\Services\PlanService;
use App\Services\RechargeService;
use App\Services\TianquePayService;
use App\Services\WeChatPayService;
use App\Services\XunhupayService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;

class PaymentController extends Controller
{
    /**
     * 订单默认有效期（分钟）。微信侧 time_expire 同步使用。
     */
    private const ORDER_TTL_MINUTES = 15;

    // ============== Client APIs ==============

    /**
     * 创建订单。同一用户同一 plan 的未过期 pending 订单复用。
     */
    public function create(Request $request, WeChatPayService $wxpay)
    {
        // 0.x: 防御性检查 wxpay_enabled，避免后台关闭通道后仍能被调用
        if (!\App\Models\SystemSetting::getValue('wxpay_enabled', false)) {
            return response()->json(['error' => 'wechat_pay_disabled', 'message' => '微信支付通道已关闭'], 503);
        }
        $validator = Validator::make($request->all(), [
            'plan_id' => 'required|integer|exists:plans,id',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        if (!$wxpay->isConfigured()) {
            return response()->json(['error' => '微信支付未配置或已禁用'], 400);
        }

        $user = auth()->user();
        $plan = Plan::with(['modelAssignments', 'permissions'])->findOrFail((int)$request->input('plan_id'));
        $oemService = app(OemChannelService::class);
        $oemProjectKey = $oemService->resolveOrderOemProjectKey($request, $user);

        if ($plan->status !== 'active') {
            return response()->json(['error' => '套餐已归档，无法购买'], 400);
        }
        if (!$oemService->planVisibleToChannel($plan, $oemProjectKey)) {
            return response()->json(['error' => '当前渠道不可购买此套餐'], 403);
        }
        if ((float)$plan->price <= 0) {
            return response()->json(['error' => '此套餐金额无效，无法在线购买'], 400);
        }
        // 微信支付目前仅支持 CNY；其他币种套餐不允许走微信通道
        if (strtoupper((string)($plan->currency ?: 'CNY')) !== 'CNY') {
            return response()->json(['error' => '此套餐币种不支持微信支付'], 400);
        }

        // 永久套餐（duration_days<=0）允许复购：每次都按新购处理，独立发放额度，不走续费、不拦截。
        // 限时套餐在持有期内仍走续费（叠加时长）。
        $renewUserPlan = (int)$plan->duration_days > 0
            ? $this->findRenewableUserPlan((int)$user->id, (int)$plan->id)
            : null;
        $orderType = $renewUserPlan ? PaymentOrder::TYPE_RENEW : PaymentOrder::TYPE_PURCHASE;

        // 复用未过期 pending 订单
        $existingQuery = PaymentOrder::where('user_id', $user->id)
            ->where('plan_id', $plan->id)
            ->where('channel', 'wechat_native')
            ->where('order_type', $orderType)
            ->where('status', PaymentOrder::STATUS_PENDING)
            ->where('expires_at', '>', now());
        if ($oemProjectKey) {
            $existingQuery->where('oem_project_key', $oemProjectKey);
        } else {
            $existingQuery->whereNull('oem_project_key');
        }
        if ($renewUserPlan) {
            $existingQuery->where('upgrade_from_user_plan_id', $renewUserPlan->id);
        } else {
            $existingQuery->whereNull('upgrade_from_user_plan_id');
        }
        $existing = $existingQuery->orderByDesc('id')->first();
        if ($existing) {
            return response()->json($this->formatOrderForClient($existing, true));
        }

        // 生成快照
        $snapshot = $this->buildSnapshot($plan);

        // 创建订单
        $now       = now();
        $expiresAt = $now->copy()->addMinutes(self::ORDER_TTL_MINUTES);

        try {
            $order = DB::transaction(function () use ($user, $plan, $snapshot, $expiresAt, $request, $orderType, $renewUserPlan, $oemService, $oemProjectKey) {
                $payload = [
                    'order_no'       => PaymentOrder::generateOrderNo(),
                    'user_id'        => $user->id,
                    'plan_id'        => $plan->id,
                    'plan_snapshot'  => $snapshot,
                    'amount'         => (float)$plan->price,
                    'currency'       => $plan->currency ?: 'CNY',
                    'channel'        => 'wechat_native',
                    'order_type'     => $orderType,
                    'status'         => PaymentOrder::STATUS_PENDING,
                    'expires_at'     => $expiresAt,
                    'upgrade_from_user_plan_id' => $renewUserPlan?->id,
                    'remark'         => $orderType === PaymentOrder::TYPE_RENEW ? "[renew] plan={$plan->code}" : "[create] plan={$plan->code}",
                    'client_ip'      => substr((string)$request->ip(), 0, 45),
                ];
                return PaymentOrder::create($oemService->attachOrderCommissionFields($payload, $oemProjectKey));
            });
        } catch (\Throwable $e) {
            Log::error('[payment] create order failed: ' . $e->getMessage());
            return response()->json(['error' => '创建订单失败'], 500);
        }

        // 调微信下单
        try {
            $notifyUrl = $this->buildNotifyUrl($request);
            $codeUrl = $wxpay->nativePrepay($order, $notifyUrl, $plan->name);
            $order->code_url = $codeUrl;
            $order->save();
        } catch (\Throwable $e) {
            Log::error('[payment] wxpay nativePrepay failed: ' . $e->getMessage());
            // 下单失败置 failed 状态，避免脏 pending 订单
            $order->status = PaymentOrder::STATUS_FAILED;
            $order->remark = '[create] wxpay error: ' . mb_substr($e->getMessage(), 0, 200);
            $order->save();
            return response()->json(['error' => '微信支付下单失败：' . $e->getMessage()], 502);
        }

        return response()->json($this->formatOrderForClient($order, false), 201);
    }

    public function createUpgradeOrder(Request $request, WeChatPayService $wxpay)
    {
        if (!\App\Models\SystemSetting::getValue('wxpay_enabled', false)) {
            return response()->json(['error' => 'wechat_pay_disabled', 'message' => '微信支付通道已关闭'], 503);
        }

        $validator = Validator::make($request->all(), [
            'from_user_plan_id' => 'required|integer|exists:user_plans,id',
            'plan_id' => 'required|integer|exists:plans,id',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }
        if (!$wxpay->isConfigured()) {
            return response()->json(['error' => '微信支付未配置或已禁用'], 400);
        }

        $user = auth()->user();
        $fromUserPlan = UserPlan::where('id', (int)$request->input('from_user_plan_id'))
            ->where('user_id', $user->id)
            ->first();
        if (!$fromUserPlan || !$fromUserPlan->isActive()) {
            return response()->json(['error' => '原套餐不存在或已失效，无法升级'], 400);
        }

        $plan = Plan::with(['modelAssignments', 'permissions'])->findOrFail((int)$request->input('plan_id'));
        $oemService = app(OemChannelService::class);
        $oemProjectKey = $oemService->resolveOrderOemProjectKey($request, $user);
        if ($plan->status !== 'active') {
            return response()->json(['error' => '目标套餐已归档，无法升级'], 400);
        }
        if (!$oemService->planVisibleToChannel($plan, $oemProjectKey)) {
            return response()->json(['error' => '当前渠道不可升级到此套餐'], 403);
        }
        if ((int)$fromUserPlan->plan_id === (int)$plan->id) {
            return response()->json(['error' => '目标套餐不能与当前套餐相同'], 400);
        }
        if ((float)$plan->price <= 0) {
            return response()->json(['error' => '此套餐金额无效，无法在线升级'], 400);
        }
        if (strtoupper((string)($plan->currency ?: 'CNY')) !== 'CNY') {
            return response()->json(['error' => '此套餐币种不支持微信支付'], 400);
        }

        $existingQuery = PaymentOrder::where('user_id', $user->id)
            ->where('plan_id', $plan->id)
            ->where('channel', 'wechat_native')
            ->where('order_type', PaymentOrder::TYPE_UPGRADE)
            ->where('upgrade_from_user_plan_id', $fromUserPlan->id)
            ->where('status', PaymentOrder::STATUS_PENDING)
            ->where('expires_at', '>', now());
        if ($oemProjectKey) {
            $existingQuery->where('oem_project_key', $oemProjectKey);
        } else {
            $existingQuery->whereNull('oem_project_key');
        }
        $existing = $existingQuery->orderByDesc('id')->first();
        if ($existing) {
            return response()->json($this->formatOrderForClient($existing, true));
        }

        $snapshot = $this->buildSnapshot($plan);
        $expiresAt = now()->copy()->addMinutes(self::ORDER_TTL_MINUTES);

        try {
            $order = DB::transaction(function () use ($user, $plan, $snapshot, $expiresAt, $request, $fromUserPlan, $oemService, $oemProjectKey) {
                $payload = [
                    'order_no'       => PaymentOrder::generateOrderNo(),
                    'user_id'        => $user->id,
                    'plan_id'        => $plan->id,
                    'plan_snapshot'  => $snapshot,
                    'amount'         => (float)$plan->price,
                    'currency'       => $plan->currency ?: 'CNY',
                    'channel'        => 'wechat_native',
                    'order_type'     => PaymentOrder::TYPE_UPGRADE,
                    'status'         => PaymentOrder::STATUS_PENDING,
                    'expires_at'     => $expiresAt,
                    'upgrade_from_user_plan_id' => $fromUserPlan->id,
                    'remark'         => "[upgrade] from_user_plan={$fromUserPlan->id} to_plan={$plan->code}",
                    'client_ip'      => substr((string)$request->ip(), 0, 45),
                ];
                return PaymentOrder::create($oemService->attachOrderCommissionFields($payload, $oemProjectKey));
            });
        } catch (\Throwable $e) {
            Log::error('[payment] create upgrade order failed: ' . $e->getMessage());
            return response()->json(['error' => '创建升级订单失败'], 500);
        }

        try {
            $notifyUrl = $this->buildNotifyUrl($request);
            $codeUrl = $wxpay->nativePrepay($order, $notifyUrl, $plan->name);
            $order->code_url = $codeUrl;
            $order->save();
        } catch (\Throwable $e) {
            Log::error('[payment] wxpay upgrade nativePrepay failed: ' . $e->getMessage());
            $order->status = PaymentOrder::STATUS_FAILED;
            $order->remark = '[upgrade] wxpay error: ' . mb_substr($e->getMessage(), 0, 200);
            $order->save();
            return response()->json(['error' => '微信支付下单失败：' . $e->getMessage()], 502);
        }

        return response()->json($this->formatOrderForClient($order, false), 201);
    }

    /**
     * 查询订单状态（仅本人）。
     */
    public function show(Request $request, string $orderNo)
    {
        $order = PaymentOrder::where('order_no', $orderNo)
            ->where('user_id', auth()->id())
            ->first();
        if (!$order) {
            return response()->json(['error' => '订单不存在'], 404);
        }
        return response()->json($this->formatOrderForClient($order, false));
    }

    /**
     * 主动取消订单（仅 pending 可取消）。
     */
    public function cancel(Request $request, string $orderNo, WeChatPayService $wxpay)
    {
        $order = PaymentOrder::where('order_no', $orderNo)
            ->where('user_id', auth()->id())
            ->first();
        if (!$order) {
            return response()->json(['error' => '订单不存在'], 404);
        }
        if (!$order->isPending()) {
            return response()->json(['error' => '订单非待支付状态，无法取消'], 400);
        }

        try {
            $wxpay->closeOrder($order->order_no);
        } catch (\Throwable $e) {
            // 微信侧关单失败不影响本地状态切换，仅记录
            Log::warning('[payment] wxpay closeOrder failed: ' . $e->getMessage());
        }

        PaymentOrder::assertTransition($order->status, PaymentOrder::STATUS_CLOSED);
        $order->status    = PaymentOrder::STATUS_CLOSED;
        $order->closed_at = now();
        $order->save();

        return response()->json(['success' => true, 'order_no' => $order->order_no, 'status' => $order->status]);
    }

    // ============== Tianque Payment (聚合支付：用户扫码) ==============

    /**
     * 创建天阙支付订单。与微信 create() 流程平行，区别：
     *   - 调天阙 nativePrepay 取 payUrl 二维码（语义同微信 code_url）
     *   - 天阙没有异步 notify，需客户端调 tianqueSync 轮询同步状态
     */
    public function createTianque(Request $request, TianquePayService $tianque)
    {
        // 0.x: 防御性检查 tianque_enabled，避免后台关闭通道后仍能被调用
        if (!\App\Models\SystemSetting::getValue('tianque_enabled', false)) {
            return response()->json(['error' => 'tianque_pay_disabled', 'message' => '聚合支付通道已关闭'], 503);
        }
        $validator = Validator::make($request->all(), [
            'plan_id' => 'required|integer|exists:plans,id',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        if (!$tianque->isConfigured()) {
            return response()->json(['error' => '天阙支付未配置或已禁用'], 400);
        }

        $user = auth()->user();
        $plan = Plan::with(['modelAssignments', 'permissions'])->findOrFail((int)$request->input('plan_id'));
        $oemService = app(OemChannelService::class);
        $oemProjectKey = $oemService->resolveOrderOemProjectKey($request, $user);

        if ($plan->status !== 'active') {
            return response()->json(['error' => '套餐已归档，无法购买'], 400);
        }
        if (!$oemService->planVisibleToChannel($plan, $oemProjectKey)) {
            return response()->json(['error' => '当前渠道不可购买此套餐'], 403);
        }
        if ((float)$plan->price <= 0) {
            return response()->json(['error' => '此套餐金额无效，无法在线购买'], 400);
        }
        // 天阙仅支持 CNY
        if (strtoupper((string)($plan->currency ?: 'CNY')) !== 'CNY') {
            return response()->json(['error' => '此套餐币种不支持天阙支付'], 400);
        }

        // 永久套餐（duration_days<=0）允许复购：每次都按新购处理，独立发放额度，不走续费、不拦截。
        // 限时套餐在持有期内仍走续费（叠加时长）。
        $renewUserPlan = (int)$plan->duration_days > 0
            ? $this->findRenewableUserPlan((int)$user->id, (int)$plan->id)
            : null;
        $orderType = $renewUserPlan ? PaymentOrder::TYPE_RENEW : PaymentOrder::TYPE_PURCHASE;

        // 复用未过期 pending 订单（同 channel 才复用，避免微信和天阙订单串）
        $existingQuery = PaymentOrder::where('user_id', $user->id)
            ->where('plan_id', $plan->id)
            ->where('channel', 'tianque_native')
            ->where('order_type', $orderType)
            ->where('status', PaymentOrder::STATUS_PENDING)
            ->where('expires_at', '>', now());
        if ($oemProjectKey) {
            $existingQuery->where('oem_project_key', $oemProjectKey);
        } else {
            $existingQuery->whereNull('oem_project_key');
        }
        if ($renewUserPlan) {
            $existingQuery->where('upgrade_from_user_plan_id', $renewUserPlan->id);
        } else {
            $existingQuery->whereNull('upgrade_from_user_plan_id');
        }
        $existing = $existingQuery->orderByDesc('id')->first();
        if ($existing) {
            return response()->json($this->formatOrderForClient($existing, true));
        }

        $snapshot  = $this->buildSnapshot($plan);
        $now       = now();
        $expiresAt = $now->copy()->addMinutes(self::ORDER_TTL_MINUTES);
        $clientIp  = substr((string)$request->ip(), 0, 45);

        try {
            $order = DB::transaction(function () use ($user, $plan, $snapshot, $expiresAt, $clientIp, $orderType, $renewUserPlan, $oemService, $oemProjectKey) {
                $payload = [
                    'order_no'       => PaymentOrder::generateOrderNo(),
                    'user_id'        => $user->id,
                    'plan_id'        => $plan->id,
                    'plan_snapshot'  => $snapshot,
                    'amount'         => (float)$plan->price,
                    'currency'       => $plan->currency ?: 'CNY',
                    'channel'        => 'tianque_native',
                    'order_type'     => $orderType,
                    'status'         => PaymentOrder::STATUS_PENDING,
                    'expires_at'     => $expiresAt,
                    'upgrade_from_user_plan_id' => $renewUserPlan?->id,
                    'remark'         => $orderType === PaymentOrder::TYPE_RENEW ? "[renew] tianque plan={$plan->code}" : "[create] tianque plan={$plan->code}",
                    'client_ip'      => $clientIp,
                ];
                return PaymentOrder::create($oemService->attachOrderCommissionFields($payload, $oemProjectKey));
            });
        } catch (\Throwable $e) {
            Log::error('[payment] create tianque order failed: ' . $e->getMessage());
            return response()->json(['error' => '创建订单失败'], 500);
        }

        // 调天阙下单
        try {
            $result = $tianque->nativePrepay($order, $plan->name, $clientIp);
            $order->code_url = $result['payUrl'];
            // 复用 wx_transaction_id 字段存天阙 uuid（聚合支付的"订单号"）
            $order->wx_transaction_id = $result['uuid'];
            $order->save();
        } catch (\Throwable $e) {
            Log::error('[payment] tianque nativePrepay failed: ' . $e->getMessage());
            $order->status = PaymentOrder::STATUS_FAILED;
            $order->remark = '[create] tianque error: ' . mb_substr($e->getMessage(), 0, 200);
            $order->save();
            return response()->json(['error' => '天阙支付下单失败：' . $e->getMessage()], 502);
        }

        return response()->json($this->formatOrderForClient($order, false), 201);
    }

    public function createTianqueUpgrade(Request $request, TianquePayService $tianque)
    {
        if (!\App\Models\SystemSetting::getValue('tianque_enabled', false)) {
            return response()->json(['error' => 'tianque_pay_disabled', 'message' => '聚合支付通道已关闭'], 503);
        }

        $validator = Validator::make($request->all(), [
            'from_user_plan_id' => 'required|integer|exists:user_plans,id',
            'plan_id' => 'required|integer|exists:plans,id',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }
        if (!$tianque->isConfigured()) {
            return response()->json(['error' => '天阙支付未配置或已禁用'], 400);
        }

        $user = auth()->user();
        $fromUserPlan = UserPlan::where('id', (int)$request->input('from_user_plan_id'))
            ->where('user_id', $user->id)
            ->first();
        if (!$fromUserPlan || !$fromUserPlan->isActive()) {
            return response()->json(['error' => '原套餐不存在或已失效，无法升级'], 400);
        }

        $plan = Plan::with(['modelAssignments', 'permissions'])->findOrFail((int)$request->input('plan_id'));
        $oemService = app(OemChannelService::class);
        $oemProjectKey = $oemService->resolveOrderOemProjectKey($request, $user);
        if ($plan->status !== 'active') {
            return response()->json(['error' => '目标套餐已归档，无法升级'], 400);
        }
        if (!$oemService->planVisibleToChannel($plan, $oemProjectKey)) {
            return response()->json(['error' => '当前渠道不可升级到此套餐'], 403);
        }
        if ((int)$fromUserPlan->plan_id === (int)$plan->id) {
            return response()->json(['error' => '目标套餐不能与当前套餐相同'], 400);
        }
        if ((float)$plan->price <= 0) {
            return response()->json(['error' => '此套餐金额无效，无法在线升级'], 400);
        }
        if (strtoupper((string)($plan->currency ?: 'CNY')) !== 'CNY') {
            return response()->json(['error' => '此套餐币种不支持天阙支付'], 400);
        }

        $existingQuery = PaymentOrder::where('user_id', $user->id)
            ->where('plan_id', $plan->id)
            ->where('channel', 'tianque_native')
            ->where('order_type', PaymentOrder::TYPE_UPGRADE)
            ->where('upgrade_from_user_plan_id', $fromUserPlan->id)
            ->where('status', PaymentOrder::STATUS_PENDING)
            ->where('expires_at', '>', now());
        if ($oemProjectKey) {
            $existingQuery->where('oem_project_key', $oemProjectKey);
        } else {
            $existingQuery->whereNull('oem_project_key');
        }
        $existing = $existingQuery->orderByDesc('id')->first();
        if ($existing) {
            return response()->json($this->formatOrderForClient($existing, true));
        }

        $snapshot = $this->buildSnapshot($plan);
        $expiresAt = now()->copy()->addMinutes(self::ORDER_TTL_MINUTES);
        $clientIp = substr((string)$request->ip(), 0, 45);

        try {
            $order = DB::transaction(function () use ($user, $plan, $snapshot, $expiresAt, $clientIp, $fromUserPlan, $oemService, $oemProjectKey) {
                $payload = [
                    'order_no'       => PaymentOrder::generateOrderNo(),
                    'user_id'        => $user->id,
                    'plan_id'        => $plan->id,
                    'plan_snapshot'  => $snapshot,
                    'amount'         => (float)$plan->price,
                    'currency'       => $plan->currency ?: 'CNY',
                    'channel'        => 'tianque_native',
                    'order_type'     => PaymentOrder::TYPE_UPGRADE,
                    'status'         => PaymentOrder::STATUS_PENDING,
                    'expires_at'     => $expiresAt,
                    'upgrade_from_user_plan_id' => $fromUserPlan->id,
                    'remark'         => "[upgrade] tianque from_user_plan={$fromUserPlan->id} to_plan={$plan->code}",
                    'client_ip'      => $clientIp,
                ];
                return PaymentOrder::create($oemService->attachOrderCommissionFields($payload, $oemProjectKey));
            });
        } catch (\Throwable $e) {
            Log::error('[payment] create tianque upgrade order failed: ' . $e->getMessage());
            return response()->json(['error' => '创建升级订单失败'], 500);
        }

        try {
            $result = $tianque->nativePrepay($order, $plan->name, $clientIp);
            $order->code_url = $result['payUrl'];
            $order->wx_transaction_id = $result['uuid'];
            $order->save();
        } catch (\Throwable $e) {
            Log::error('[payment] tianque upgrade nativePrepay failed: ' . $e->getMessage());
            $order->status = PaymentOrder::STATUS_FAILED;
            $order->remark = '[upgrade] tianque error: ' . mb_substr($e->getMessage(), 0, 200);
            $order->save();
            return response()->json(['error' => '天阙支付下单失败：' . $e->getMessage()], 502);
        }

        return response()->json($this->formatOrderForClient($order, false), 201);
    }

    /**
     * 客户端轮询天阙订单状态。
     *
     * 因天阙未提供异步 notify，桌面端需每 2-3 秒调用此接口主动拉取支付结果。
     * 后端调天阙 queryOrder 同步状态，必要时结算订单（发放套餐）。
     */
    public function tianqueSync(Request $request, string $orderNo, TianquePayService $tianque, PlanService $planService)
    {
        $order = PaymentOrder::where('order_no', $orderNo)
            ->where('user_id', auth()->id())
            ->first();
        if (!$order) {
            return response()->json(['error' => '订单不存在'], 404);
        }
        if ($order->channel !== 'tianque_native') {
            return response()->json(['error' => '此订单非天阙支付订单'], 400);
        }

        // 已结算订单（paid/closed/failed/refunded）直接返回，无需再调天阙
        if (!$order->isPending()) {
            return response()->json($this->formatOrderForClient($order, false));
        }

        // pending 但已过期，仅本地标记，无需调天阙
        if ($order->isExpired()) {
            return response()->json($this->formatOrderForClient($order, false));
        }

        try {
            $tx = $tianque->queryOrder($order->order_no);
        } catch (\Throwable $e) {
            // 查询失败不破坏订单状态，仅记录日志返回当前状态
            Log::warning('[payment] tianque queryOrder failed: ' . $e->getMessage());
            return response()->json($this->formatOrderForClient($order, false));
        }

        $tranSts = (string)($tx['tranSts'] ?? '');

        if ($tranSts === 'SUCCESS') {
            try {
                DB::transaction(function () use ($order, $tx, $planService) {
                    $fresh = PaymentOrder::where('id', $order->id)->lockForUpdate()->first();
                    if (!$fresh || $fresh->status !== PaymentOrder::STATUS_PENDING) return;
                    $this->settleTianquePaidOrder($fresh, $tx, $planService, '[tianque_sync]');
                });
            } catch (\Throwable $e) {
                Log::error('[payment] tianque settle failed: ' . $e->getMessage());
                return response()->json(['error' => '结算失败：' . $e->getMessage()], 500);
            }
            $order->refresh();
        } elseif (in_array($tranSts, ['FAIL', 'CLOSED', 'CANCELED'], true)) {
            try {
                DB::transaction(function () use ($order) {
                    $fresh = PaymentOrder::where('id', $order->id)->lockForUpdate()->first();
                    if (!$fresh || $fresh->status !== PaymentOrder::STATUS_PENDING) return;
                    PaymentOrder::assertTransition($fresh->status, PaymentOrder::STATUS_CLOSED);
                    $fresh->status    = PaymentOrder::STATUS_CLOSED;
                    $fresh->closed_at = now();
                    $fresh->save();
                });
            } catch (\Throwable $e) {
                Log::warning('[payment] tianque close failed: ' . $e->getMessage());
            }
            $order->refresh();
        }
        // PAYING 或其他中间态：保持 pending，客户端继续轮询

        return response()->json($this->formatOrderForClient($order, false));
    }

    /**
     * 结算天阙支付订单。与 settlePaidOrder 类似但金额校验逻辑不同
     * （天阙 amt 是字符串元单位，微信 amount.total 是分单位整数）。
     */
    private function settleTianquePaidOrder(
        PaymentOrder $order,
        array $tx,
        PlanService $planService,
        string $remarkPrefix
    ): void {
        $user = $order->user()->first();
        if (!$user) {
            Log::error("[payment] tianque order user missing order={$order->order_no} user_id={$order->user_id}");
            throw new \RuntimeException('user missing');
        }

        // 留证：原始响应存 notify_payload（虽不是异步通知，但同类审计字段）
        $order->notify_payload = json_encode([
            'received_at' => now()->toIso8601String(),
            'channel'     => 'tianque_native',
            'tx'          => $tx,
        ], JSON_UNESCAPED_UNICODE);

        if ($order->order_type === PaymentOrder::TYPE_RECHARGE) {
            app(RechargeService::class)->fulfill($order, $user, $remarkPrefix);
            $userPlan = null;
        } elseif ($order->order_type === PaymentOrder::TYPE_RENEW) {
            $renewUserPlan = UserPlan::where('id', (int)$order->upgrade_from_user_plan_id)
                ->where('user_id', $user->id)
                ->first();
            if (!$renewUserPlan) {
                throw new \RuntimeException('renew source plan missing');
            }
            $userPlan = $planService->renewFromSnapshot($user, $renewUserPlan, (array)$order->plan_snapshot, [
                'remark' => sprintf('%s %s', $remarkPrefix, $order->order_no),
            ]);
        } elseif ($order->order_type === PaymentOrder::TYPE_UPGRADE) {
            $fromUserPlan = UserPlan::where('id', (int)$order->upgrade_from_user_plan_id)
                ->where('user_id', $user->id)
                ->first();
            if (!$fromUserPlan) {
                throw new \RuntimeException('upgrade source plan missing');
            }
            $userPlan = $planService->upgradeFromSnapshot($user, $fromUserPlan, (array)$order->plan_snapshot, [
                'remark' => sprintf('%s %s', $remarkPrefix, $order->order_no),
            ]);
        } else {
            $userPlan = $planService->grantFromSnapshot($user, (array)$order->plan_snapshot, [
                'source' => 'purchase',
                'remark' => sprintf('%s %s', $remarkPrefix, $order->order_no),
            ]);
        }

        // 状态机校验 + 更新订单
        PaymentOrder::assertTransition($order->status, PaymentOrder::STATUS_PAID);
        $order->status            = PaymentOrder::STATUS_PAID;
        $order->paid_at           = now();
        // 复用 wx_transaction_id 字段存天阙渠道流水号（微信/支付宝/云闪付的 transactionId）
        $order->wx_transaction_id = (string)($tx['transactionId'] ?? $tx['uuid'] ?? $order->wx_transaction_id);
        $order->user_plan_id      = $userPlan?->id;
        $order->save();
        app(OemChannelService::class)->settleCommission($order);
    }

    // ============== Xunhupay Payment (虎皮椒聚合支付：扫码 + 异步 notify) ==============

    /**
     * 创建虎皮椒支付订单。与天阙 createTianque 平行，区别：
     *   - 调虎皮椒统一下单取 payUrl（语义同微信 code_url）
     *   - 虎皮椒有异步 notify 回调（结算走 xunhupayNotify），同时保留 xunhupaySync 主动查单兜底
     */
    public function createXunhupay(Request $request, XunhupayService $xunhupay)
    {
        if (!\App\Models\SystemSetting::getValue('xunhupay_enabled', false)) {
            return response()->json(['error' => 'xunhupay_pay_disabled', 'message' => '虎皮椒支付通道已关闭'], 503);
        }
        $validator = Validator::make($request->all(), [
            'plan_id' => 'required|integer|exists:plans,id',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }
        if (!$xunhupay->isConfigured()) {
            return response()->json(['error' => '虎皮椒支付未配置或已禁用'], 400);
        }

        $user = auth()->user();
        $plan = Plan::with(['modelAssignments', 'permissions'])->findOrFail((int)$request->input('plan_id'));
        $oemService = app(OemChannelService::class);
        $oemProjectKey = $oemService->resolveOrderOemProjectKey($request, $user);

        if ($plan->status !== 'active') {
            return response()->json(['error' => '套餐已归档，无法购买'], 400);
        }
        if (!$oemService->planVisibleToChannel($plan, $oemProjectKey)) {
            return response()->json(['error' => '当前渠道不可购买此套餐'], 403);
        }
        if ((float)$plan->price <= 0) {
            return response()->json(['error' => '此套餐金额无效，无法在线购买'], 400);
        }
        if (strtoupper((string)($plan->currency ?: 'CNY')) !== 'CNY') {
            return response()->json(['error' => '此套餐币种不支持虎皮椒支付'], 400);
        }

        $renewUserPlan = (int)$plan->duration_days > 0
            ? $this->findRenewableUserPlan((int)$user->id, (int)$plan->id)
            : null;
        $orderType = $renewUserPlan ? PaymentOrder::TYPE_RENEW : PaymentOrder::TYPE_PURCHASE;

        $existingQuery = PaymentOrder::where('user_id', $user->id)
            ->where('plan_id', $plan->id)
            ->where('channel', 'xunhupay_native')
            ->where('order_type', $orderType)
            ->where('status', PaymentOrder::STATUS_PENDING)
            ->where('expires_at', '>', now());
        if ($oemProjectKey) {
            $existingQuery->where('oem_project_key', $oemProjectKey);
        } else {
            $existingQuery->whereNull('oem_project_key');
        }
        if ($renewUserPlan) {
            $existingQuery->where('upgrade_from_user_plan_id', $renewUserPlan->id);
        } else {
            $existingQuery->whereNull('upgrade_from_user_plan_id');
        }
        $existing = $existingQuery->orderByDesc('id')->first();
        if ($existing) {
            return response()->json($this->formatOrderForClient($existing, true));
        }

        $snapshot  = $this->buildSnapshot($plan);
        $expiresAt = now()->copy()->addMinutes(self::ORDER_TTL_MINUTES);
        $clientIp  = substr((string)$request->ip(), 0, 45);

        try {
            $order = DB::transaction(function () use ($user, $plan, $snapshot, $expiresAt, $clientIp, $orderType, $renewUserPlan, $oemService, $oemProjectKey) {
                $payload = [
                    'order_no'       => PaymentOrder::generateOrderNo(),
                    'user_id'        => $user->id,
                    'plan_id'        => $plan->id,
                    'plan_snapshot'  => $snapshot,
                    'amount'         => (float)$plan->price,
                    'currency'       => $plan->currency ?: 'CNY',
                    'channel'        => 'xunhupay_native',
                    'order_type'     => $orderType,
                    'status'         => PaymentOrder::STATUS_PENDING,
                    'expires_at'     => $expiresAt,
                    'upgrade_from_user_plan_id' => $renewUserPlan?->id,
                    'remark'         => $orderType === PaymentOrder::TYPE_RENEW ? "[renew] xunhupay plan={$plan->code}" : "[create] xunhupay plan={$plan->code}",
                    'client_ip'      => $clientIp,
                ];
                return PaymentOrder::create($oemService->attachOrderCommissionFields($payload, $oemProjectKey));
            });
        } catch (\Throwable $e) {
            Log::error('[payment] create xunhupay order failed: ' . $e->getMessage());
            return response()->json(['error' => '创建订单失败'], 500);
        }

        try {
            $result = $xunhupay->nativePrepay($order, $this->buildXunhupayNotifyUrl($request), $plan->name);
            $order->code_url = $result['payUrl'];
            $order->save();
        } catch (\Throwable $e) {
            Log::error('[payment] xunhupay nativePrepay failed: ' . $e->getMessage());
            $order->status = PaymentOrder::STATUS_FAILED;
            $order->remark = '[create] xunhupay error: ' . mb_substr($e->getMessage(), 0, 200);
            $order->save();
            return response()->json(['error' => '虎皮椒支付下单失败：' . $e->getMessage()], 502);
        }

        return response()->json($this->formatOrderForClient($order, false), 201);
    }

    public function createXunhupayUpgrade(Request $request, XunhupayService $xunhupay)
    {
        if (!\App\Models\SystemSetting::getValue('xunhupay_enabled', false)) {
            return response()->json(['error' => 'xunhupay_pay_disabled', 'message' => '虎皮椒支付通道已关闭'], 503);
        }
        $validator = Validator::make($request->all(), [
            'from_user_plan_id' => 'required|integer|exists:user_plans,id',
            'plan_id' => 'required|integer|exists:plans,id',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }
        if (!$xunhupay->isConfigured()) {
            return response()->json(['error' => '虎皮椒支付未配置或已禁用'], 400);
        }

        $user = auth()->user();
        $fromUserPlan = UserPlan::where('id', (int)$request->input('from_user_plan_id'))
            ->where('user_id', $user->id)
            ->first();
        if (!$fromUserPlan || !$fromUserPlan->isActive()) {
            return response()->json(['error' => '原套餐不存在或已失效，无法升级'], 400);
        }

        $plan = Plan::with(['modelAssignments', 'permissions'])->findOrFail((int)$request->input('plan_id'));
        $oemService = app(OemChannelService::class);
        $oemProjectKey = $oemService->resolveOrderOemProjectKey($request, $user);
        if ($plan->status !== 'active') {
            return response()->json(['error' => '目标套餐已归档，无法升级'], 400);
        }
        if (!$oemService->planVisibleToChannel($plan, $oemProjectKey)) {
            return response()->json(['error' => '当前渠道不可升级到此套餐'], 403);
        }
        if ((int)$fromUserPlan->plan_id === (int)$plan->id) {
            return response()->json(['error' => '目标套餐不能与当前套餐相同'], 400);
        }
        if ((float)$plan->price <= 0) {
            return response()->json(['error' => '此套餐金额无效，无法在线升级'], 400);
        }
        if (strtoupper((string)($plan->currency ?: 'CNY')) !== 'CNY') {
            return response()->json(['error' => '此套餐币种不支持虎皮椒支付'], 400);
        }

        $existingQuery = PaymentOrder::where('user_id', $user->id)
            ->where('plan_id', $plan->id)
            ->where('channel', 'xunhupay_native')
            ->where('order_type', PaymentOrder::TYPE_UPGRADE)
            ->where('upgrade_from_user_plan_id', $fromUserPlan->id)
            ->where('status', PaymentOrder::STATUS_PENDING)
            ->where('expires_at', '>', now());
        if ($oemProjectKey) {
            $existingQuery->where('oem_project_key', $oemProjectKey);
        } else {
            $existingQuery->whereNull('oem_project_key');
        }
        $existing = $existingQuery->orderByDesc('id')->first();
        if ($existing) {
            return response()->json($this->formatOrderForClient($existing, true));
        }

        $snapshot = $this->buildSnapshot($plan);
        $expiresAt = now()->copy()->addMinutes(self::ORDER_TTL_MINUTES);
        $clientIp = substr((string)$request->ip(), 0, 45);

        try {
            $order = DB::transaction(function () use ($user, $plan, $snapshot, $expiresAt, $clientIp, $fromUserPlan, $oemService, $oemProjectKey) {
                $payload = [
                    'order_no'       => PaymentOrder::generateOrderNo(),
                    'user_id'        => $user->id,
                    'plan_id'        => $plan->id,
                    'plan_snapshot'  => $snapshot,
                    'amount'         => (float)$plan->price,
                    'currency'       => $plan->currency ?: 'CNY',
                    'channel'        => 'xunhupay_native',
                    'order_type'     => PaymentOrder::TYPE_UPGRADE,
                    'status'         => PaymentOrder::STATUS_PENDING,
                    'expires_at'     => $expiresAt,
                    'upgrade_from_user_plan_id' => $fromUserPlan->id,
                    'remark'         => "[upgrade] xunhupay from_user_plan={$fromUserPlan->id} to_plan={$plan->code}",
                    'client_ip'      => $clientIp,
                ];
                return PaymentOrder::create($oemService->attachOrderCommissionFields($payload, $oemProjectKey));
            });
        } catch (\Throwable $e) {
            Log::error('[payment] create xunhupay upgrade order failed: ' . $e->getMessage());
            return response()->json(['error' => '创建升级订单失败'], 500);
        }

        try {
            $result = $xunhupay->nativePrepay($order, $this->buildXunhupayNotifyUrl($request), $plan->name);
            $order->code_url = $result['payUrl'];
            $order->save();
        } catch (\Throwable $e) {
            Log::error('[payment] xunhupay upgrade nativePrepay failed: ' . $e->getMessage());
            $order->status = PaymentOrder::STATUS_FAILED;
            $order->remark = '[upgrade] xunhupay error: ' . mb_substr($e->getMessage(), 0, 200);
            $order->save();
            return response()->json(['error' => '虎皮椒支付下单失败：' . $e->getMessage()], 502);
        }

        return response()->json($this->formatOrderForClient($order, false), 201);
    }

    /**
     * 虎皮椒直充下单（聚合支付）。
     */
    public function createXunhupayRecharge(Request $request, XunhupayService $xunhupay, RechargeService $rechargeService)
    {
        if (!\App\Models\SystemSetting::getValue('xunhupay_enabled', false)) {
            return response()->json(['error' => 'xunhupay_pay_disabled', 'message' => '虎皮椒支付通道已关闭'], 503);
        }
        $validator = Validator::make($request->all(), [
            'balance_type' => 'required|in:token,credit',
            'amount' => 'nullable|numeric|min:0.01|max:100000',
            'package_id' => 'nullable|integer|exists:recharge_packages,id',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }
        if (!$xunhupay->isConfigured()) {
            return response()->json(['error' => '虎皮椒支付未配置或已禁用'], 400);
        }

        $user = auth()->user();
        $oemService = app(OemChannelService::class);
        $oemProjectKey = $oemService->resolveOrderOemProjectKey($request, $user);

        try {
            $quote = $rechargeService->quote(
                (string) $request->input('balance_type'),
                $request->filled('amount') ? (float) $request->input('amount') : null,
                $request->filled('package_id') ? (int) $request->input('package_id') : null,
            );
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        $existing = $this->findReusableRechargeOrder((int) $user->id, 'xunhupay_native', $quote, $oemProjectKey);
        if ($existing) {
            return response()->json($this->formatOrderForClient($existing, true));
        }

        $snapshot = $rechargeService->buildSnapshot($quote);
        $expiresAt = now()->copy()->addMinutes(self::ORDER_TTL_MINUTES);
        $clientIp = substr((string) $request->ip(), 0, 45);

        try {
            $order = DB::transaction(function () use ($user, $quote, $snapshot, $expiresAt, $clientIp, $oemService, $oemProjectKey) {
                $payload = [
                    'order_no'      => PaymentOrder::generateOrderNo(),
                    'user_id'       => $user->id,
                    'plan_id'       => null,
                    'plan_snapshot' => $snapshot,
                    'amount'        => $quote['pay_amount'],
                    'currency'      => 'CNY',
                    'channel'       => 'xunhupay_native',
                    'order_type'    => PaymentOrder::TYPE_RECHARGE,
                    'status'        => PaymentOrder::STATUS_PENDING,
                    'expires_at'    => $expiresAt,
                    'remark'        => '[recharge] xunhupay ' . $quote['balance_type'],
                    'client_ip'     => $clientIp,
                ];
                return PaymentOrder::create($oemService->attachOrderCommissionFields($payload, $oemProjectKey));
            });
        } catch (\Throwable $e) {
            Log::error('[payment] create xunhupay recharge order failed: ' . $e->getMessage());
            return response()->json(['error' => '创建订单失败'], 500);
        }

        try {
            $result = $xunhupay->nativePrepay($order, $this->buildXunhupayNotifyUrl($request), $this->rechargeDescription($quote));
            $order->code_url = $result['payUrl'];
            $order->save();
        } catch (\Throwable $e) {
            Log::error('[payment] xunhupay recharge nativePrepay failed: ' . $e->getMessage());
            $order->status = PaymentOrder::STATUS_FAILED;
            $order->remark = '[recharge] xunhupay error: ' . mb_substr($e->getMessage(), 0, 200);
            $order->save();
            return response()->json(['error' => '虎皮椒支付下单失败：' . $e->getMessage()], 502);
        }

        return response()->json($this->formatOrderForClient($order, false), 201);
    }

    /**
     * 客户端轮询虎皮椒订单状态（异步 notify 的兜底）。
     * 桌面端每 2-3 秒调用；后端主动查单，OD 则结算、CD 则关单，与 notify 幂等竞争只一方成功。
     */
    public function xunhupaySync(Request $request, string $orderNo, XunhupayService $xunhupay, PlanService $planService)
    {
        $order = PaymentOrder::where('order_no', $orderNo)
            ->where('user_id', auth()->id())
            ->first();
        if (!$order) {
            return response()->json(['error' => '订单不存在'], 404);
        }
        if ($order->channel !== 'xunhupay_native') {
            return response()->json(['error' => '此订单非虎皮椒支付订单'], 400);
        }
        if (!$order->isPending()) {
            return response()->json($this->formatOrderForClient($order, false));
        }
        if ($order->isExpired()) {
            return response()->json($this->formatOrderForClient($order, false));
        }

        try {
            $data = $xunhupay->queryOrder($order->order_no);
        } catch (\Throwable $e) {
            Log::warning('[payment] xunhupay queryOrder failed: ' . $e->getMessage());
            return response()->json($this->formatOrderForClient($order, false));
        }

        $status = (string)($data['status'] ?? '');
        if ($status === 'OD') {
            try {
                DB::transaction(function () use ($order, $data, $planService) {
                    $fresh = PaymentOrder::where('id', $order->id)->lockForUpdate()->first();
                    if (!$fresh || $fresh->status !== PaymentOrder::STATUS_PENDING) return;
                    $this->settleXunhupayPaidOrder($fresh, $data, $planService, '[xunhupay_sync]');
                });
            } catch (\Throwable $e) {
                Log::error('[payment] xunhupay settle failed: ' . $e->getMessage());
                return response()->json(['error' => '结算失败：' . $e->getMessage()], 500);
            }
            $order->refresh();
        } elseif ($status === 'CD') {
            try {
                DB::transaction(function () use ($order) {
                    $fresh = PaymentOrder::where('id', $order->id)->lockForUpdate()->first();
                    if (!$fresh || $fresh->status !== PaymentOrder::STATUS_PENDING) return;
                    PaymentOrder::assertTransition($fresh->status, PaymentOrder::STATUS_CLOSED);
                    $fresh->status = PaymentOrder::STATUS_CLOSED;
                    $fresh->closed_at = now();
                    $fresh->save();
                });
            } catch (\Throwable $e) {
                Log::warning('[payment] xunhupay close failed: ' . $e->getMessage());
            }
            $order->refresh();
        }
        // WP 待支付：保持 pending，客户端继续轮询

        return response()->json($this->formatOrderForClient($order, false));
    }

    /**
     * 虎皮椒异步回调（公开端点）。MD5 验签 + 事务 + 行锁 + 幂等 + 金额校验 + 留证。
     * 处理完必须返回纯文本 success，否则虎皮椒最多重试 6 次。
     */
    public function xunhupayNotify(Request $request, XunhupayService $xunhupay, PlanService $planService)
    {
        $params = $request->all();

        if (!$xunhupay->verifyNotify($params)) {
            Log::warning('[payment] xunhupay notify verify failed');
            return response('sign error', 400);
        }

        $orderNo = (string)($params['trade_order_id'] ?? '');
        if ($orderNo === '') {
            return response('missing trade_order_id', 400);
        }
        $status = (string)($params['status'] ?? '');

        try {
            DB::transaction(function () use ($params, $orderNo, $status, $planService) {
                /** @var PaymentOrder|null $order */
                $order = PaymentOrder::where('order_no', $orderNo)->lockForUpdate()->first();
                if (!$order) {
                    Log::warning("[payment] xunhupay notify order missing: {$orderNo}");
                    return;
                }

                $order->notify_payload = json_encode([
                    'received_at' => now()->toIso8601String(),
                    'channel'     => 'xunhupay_native',
                    'tx'          => $params,
                ], JSON_UNESCAPED_UNICODE);

                // 幂等：非 pending 不再处理
                if ($order->status !== PaymentOrder::STATUS_PENDING) {
                    $order->save();
                    return;
                }
                // 仅 OD（已支付）结算
                if ($status !== 'OD') {
                    Log::warning("[payment] xunhupay notify non-paid status: {$status} order={$orderNo}");
                    $order->save();
                    return;
                }
                // 金额校验（虎皮椒 total_fee 单位为元）
                $paidFee = (string)($params['total_fee'] ?? '');
                if ($paidFee === '' || bccomp($paidFee, (string)$order->amount, 2) !== 0) {
                    Log::error("[payment] xunhupay amount mismatch order={$orderNo} paid={$paidFee} order={$order->amount}");
                    $order->save();
                    return;
                }

                $this->settleXunhupayPaidOrder($order, $params, $planService, '[xunhupay_notify]');
            });
        } catch (\Throwable $e) {
            Log::error('[payment] xunhupay notify processing failed: ' . $e->getMessage());
            return response('fail', 500);
        }

        return response('success');
    }

    /**
     * 结算虎皮椒订单。金额只在 notify（不可信入站回调）侧用 total_fee 校验以防伪造；
     * sync / adminSync 走服务端向虎皮椒查单（可信来源），且金额在下单时已随 trade_order_id 固定，
     * 查得 status=OD 即该单已足额支付，故此处不再重复校验，只做发放 + 状态切换。
     */
    private function settleXunhupayPaidOrder(
        PaymentOrder $order,
        array $tx,
        PlanService $planService,
        string $remarkPrefix
    ): void {
        $user = $order->user()->first();
        if (!$user) {
            Log::error("[payment] xunhupay order user missing order={$order->order_no} user_id={$order->user_id}");
            throw new \RuntimeException('user missing');
        }

        $order->notify_payload = json_encode([
            'received_at' => now()->toIso8601String(),
            'channel'     => 'xunhupay_native',
            'tx'          => $tx,
        ], JSON_UNESCAPED_UNICODE);

        if ($order->order_type === PaymentOrder::TYPE_RECHARGE) {
            app(RechargeService::class)->fulfill($order, $user, $remarkPrefix);
            $userPlan = null;
        } elseif ($order->order_type === PaymentOrder::TYPE_RENEW) {
            $renewUserPlan = UserPlan::where('id', (int)$order->upgrade_from_user_plan_id)
                ->where('user_id', $user->id)
                ->first();
            if (!$renewUserPlan) {
                throw new \RuntimeException('renew source plan missing');
            }
            $userPlan = $planService->renewFromSnapshot($user, $renewUserPlan, (array)$order->plan_snapshot, [
                'remark' => sprintf('%s %s', $remarkPrefix, $order->order_no),
            ]);
        } elseif ($order->order_type === PaymentOrder::TYPE_UPGRADE) {
            $fromUserPlan = UserPlan::where('id', (int)$order->upgrade_from_user_plan_id)
                ->where('user_id', $user->id)
                ->first();
            if (!$fromUserPlan) {
                throw new \RuntimeException('upgrade source plan missing');
            }
            $userPlan = $planService->upgradeFromSnapshot($user, $fromUserPlan, (array)$order->plan_snapshot, [
                'remark' => sprintf('%s %s', $remarkPrefix, $order->order_no),
            ]);
        } else {
            $userPlan = $planService->grantFromSnapshot($user, (array)$order->plan_snapshot, [
                'source' => 'purchase',
                'remark' => sprintf('%s %s', $remarkPrefix, $order->order_no),
            ]);
        }

        PaymentOrder::assertTransition($order->status, PaymentOrder::STATUS_PAID);
        $order->status            = PaymentOrder::STATUS_PAID;
        $order->paid_at           = now();
        // 复用 wx_transaction_id 字段存虎皮椒流水号（支付平台 transaction_id，回退虎皮椒 open_order_id）
        $order->wx_transaction_id = (string)($tx['transaction_id'] ?? $tx['open_order_id'] ?? $order->wx_transaction_id);
        $order->user_plan_id      = $userPlan?->id;
        $order->save();
        app(OemChannelService::class)->settleCommission($order);
    }

    /**
     * 虎皮椒异步回调地址。虎皮椒不强制 https，按 APP_URL 配置的 scheme 生成，回退请求 Host。
     */
    private function buildXunhupayNotifyUrl(Request $request): string
    {
        $base = (string) config('app.url', '');
        if ($base === '' || $base === 'http://localhost') {
            $base = $request->getSchemeAndHttpHost();
        }
        return rtrim($base, '/') . '/api/payment/xunhupay/notify';
    }

    // ============== WeChat Notify (Public) ==============

    /**
     * 微信支付回调。公开端点，依靠平台证书验签 + APIv3 解密保证安全。
     */
    public function notify(Request $request, WeChatPayService $wxpay, PlanService $planService)
    {
        // 识别微信支付「签名探测包」：签名值带 WECHATPAY/SIGNTEST/ 前缀，是平台定期
        // 发送的安全检测包。验签一定会失败，平台期望收到 4XX/5XX 应答，
        // 但不应该触发警告。这里仅用于区分日志级别，不跳过验签。
        $isProbe = str_starts_with(
            (string) $request->header('Wechatpay-Signature', ''),
            'WECHATPAY/SIGNTEST/'
        );

        try {
            $tx = $wxpay->verifyAndDecryptNotify($request);
        } catch (\Throwable $e) {
            if ($isProbe) {
                Log::debug('[payment] notify signature probe ignored: ' . $e->getMessage());
            } else {
                Log::warning('[payment] notify verify failed: ' . $e->getMessage());
            }
            return response()->json(['code' => 'FAIL', 'message' => $e->getMessage()], 401);
        }

        $orderNo = (string)($tx['out_trade_no'] ?? '');
        if ($orderNo === '') {
            return response()->json(['code' => 'FAIL', 'message' => 'missing out_trade_no'], 400);
        }

        // Watchdog: 微信支付要求回调 5 秒内应答，超时会触发重试。
        // 此处记录处理耗时，>3000ms 记 warning 作为升级到异步队列的预警信号。
        $processingStart = microtime(true);

        try {
            DB::transaction(function () use ($tx, $orderNo, $planService) {
                /** @var PaymentOrder|null $order */
                $order = PaymentOrder::where('order_no', $orderNo)->lockForUpdate()->first();
                if (!$order) {
                    // 订单不存在，但仍返回 SUCCESS 给微信，避免无限重试
                    Log::warning("[payment] notify order missing: {$orderNo}");
                    return;
                }

                // 留证：原始报文存 notify_payload
                $order->notify_payload = json_encode([
                    'received_at' => now()->toIso8601String(),
                    'tx'          => $tx,
                ], JSON_UNESCAPED_UNICODE);

                // 幂等：非 pending 状态不再处理（含已 paid、closed、failed 等）
                if ($order->status !== PaymentOrder::STATUS_PENDING) {
                    $order->save();
                    return;
                }

                // trade_state 必须为 SUCCESS
                $tradeState = (string)($tx['trade_state'] ?? '');
                if ($tradeState !== 'SUCCESS') {
                    Log::warning("[payment] notify non-success state: {$tradeState} order={$orderNo}");
                    $order->save();
                    return;
                }

                $this->settlePaidOrder($order, $tx, $planService, '[order]');
            });
        } catch (\Throwable $e) {
            Log::error('[payment] notify processing failed: ' . $e->getMessage());
            return response()->json(['code' => 'FAIL', 'message' => 'processing error'], 500);
        }

        $elapsedMs = (int) ((microtime(true) - $processingStart) * 1000);
        if ($elapsedMs > 3000) {
            Log::warning("[payment] notify processing slow: {$elapsedMs}ms order={$orderNo} (>3s, 接近微信 5s 超时阈值，建议评估异步化)");
        }

        return response()->json(['code' => 'SUCCESS']);
    }

    // ============== Recharge 直充 (Client) ==============

    /**
     * 微信直充下单：按金额/档位充值金币或积分。到账明细在 quote 阶段固化进 snapshot。
     */
    public function createRecharge(Request $request, WeChatPayService $wxpay, RechargeService $rechargeService)
    {
        if (!\App\Models\SystemSetting::getValue('wxpay_enabled', false)) {
            return response()->json(['error' => 'wechat_pay_disabled', 'message' => '微信支付通道已关闭'], 503);
        }
        $validator = Validator::make($request->all(), [
            'balance_type' => 'required|in:token,credit',
            'amount' => 'nullable|numeric|min:0.01|max:100000',
            'package_id' => 'nullable|integer|exists:recharge_packages,id',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }
        if (!$wxpay->isConfigured()) {
            return response()->json(['error' => '微信支付未配置或已禁用'], 400);
        }

        $user = auth()->user();
        $oemService = app(OemChannelService::class);
        $oemProjectKey = $oemService->resolveOrderOemProjectKey($request, $user);

        try {
            $quote = $rechargeService->quote(
                (string) $request->input('balance_type'),
                $request->filled('amount') ? (float) $request->input('amount') : null,
                $request->filled('package_id') ? (int) $request->input('package_id') : null,
            );
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        $existing = $this->findReusableRechargeOrder((int) $user->id, 'wechat_native', $quote, $oemProjectKey);
        if ($existing) {
            return response()->json($this->formatOrderForClient($existing, true));
        }

        $snapshot = $rechargeService->buildSnapshot($quote);
        $expiresAt = now()->copy()->addMinutes(self::ORDER_TTL_MINUTES);

        try {
            $order = DB::transaction(function () use ($user, $quote, $snapshot, $expiresAt, $request, $oemService, $oemProjectKey) {
                $payload = [
                    'order_no'      => PaymentOrder::generateOrderNo(),
                    'user_id'       => $user->id,
                    'plan_id'       => null,
                    'plan_snapshot' => $snapshot,
                    'amount'        => $quote['pay_amount'],
                    'currency'      => 'CNY',
                    'channel'       => 'wechat_native',
                    'order_type'    => PaymentOrder::TYPE_RECHARGE,
                    'status'        => PaymentOrder::STATUS_PENDING,
                    'expires_at'    => $expiresAt,
                    'remark'        => '[recharge] ' . $quote['balance_type'],
                    'client_ip'     => substr((string) $request->ip(), 0, 45),
                ];
                return PaymentOrder::create($oemService->attachOrderCommissionFields($payload, $oemProjectKey));
            });
        } catch (\Throwable $e) {
            Log::error('[payment] create recharge order failed: ' . $e->getMessage());
            return response()->json(['error' => '创建订单失败'], 500);
        }

        try {
            $codeUrl = $wxpay->nativePrepay($order, $this->buildNotifyUrl($request), $this->rechargeDescription($quote));
            $order->code_url = $codeUrl;
            $order->save();
        } catch (\Throwable $e) {
            Log::error('[payment] wxpay recharge nativePrepay failed: ' . $e->getMessage());
            $order->status = PaymentOrder::STATUS_FAILED;
            $order->remark = '[recharge] wxpay error: ' . mb_substr($e->getMessage(), 0, 200);
            $order->save();
            return response()->json(['error' => '微信支付下单失败：' . $e->getMessage()], 502);
        }

        return response()->json($this->formatOrderForClient($order, false), 201);
    }

    /**
     * 天阙直充下单（聚合支付）。
     */
    public function createTianqueRecharge(Request $request, TianquePayService $tianque, RechargeService $rechargeService)
    {
        if (!\App\Models\SystemSetting::getValue('tianque_enabled', false)) {
            return response()->json(['error' => 'tianque_pay_disabled', 'message' => '聚合支付通道已关闭'], 503);
        }
        $validator = Validator::make($request->all(), [
            'balance_type' => 'required|in:token,credit',
            'amount' => 'nullable|numeric|min:0.01|max:100000',
            'package_id' => 'nullable|integer|exists:recharge_packages,id',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }
        if (!$tianque->isConfigured()) {
            return response()->json(['error' => '天阙支付未配置或已禁用'], 400);
        }

        $user = auth()->user();
        $oemService = app(OemChannelService::class);
        $oemProjectKey = $oemService->resolveOrderOemProjectKey($request, $user);

        try {
            $quote = $rechargeService->quote(
                (string) $request->input('balance_type'),
                $request->filled('amount') ? (float) $request->input('amount') : null,
                $request->filled('package_id') ? (int) $request->input('package_id') : null,
            );
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        $existing = $this->findReusableRechargeOrder((int) $user->id, 'tianque_native', $quote, $oemProjectKey);
        if ($existing) {
            return response()->json($this->formatOrderForClient($existing, true));
        }

        $snapshot = $rechargeService->buildSnapshot($quote);
        $expiresAt = now()->copy()->addMinutes(self::ORDER_TTL_MINUTES);
        $clientIp = substr((string) $request->ip(), 0, 45);

        try {
            $order = DB::transaction(function () use ($user, $quote, $snapshot, $expiresAt, $clientIp, $oemService, $oemProjectKey) {
                $payload = [
                    'order_no'      => PaymentOrder::generateOrderNo(),
                    'user_id'       => $user->id,
                    'plan_id'       => null,
                    'plan_snapshot' => $snapshot,
                    'amount'        => $quote['pay_amount'],
                    'currency'      => 'CNY',
                    'channel'       => 'tianque_native',
                    'order_type'    => PaymentOrder::TYPE_RECHARGE,
                    'status'        => PaymentOrder::STATUS_PENDING,
                    'expires_at'    => $expiresAt,
                    'remark'        => '[recharge] tianque ' . $quote['balance_type'],
                    'client_ip'     => $clientIp,
                ];
                return PaymentOrder::create($oemService->attachOrderCommissionFields($payload, $oemProjectKey));
            });
        } catch (\Throwable $e) {
            Log::error('[payment] create tianque recharge order failed: ' . $e->getMessage());
            return response()->json(['error' => '创建订单失败'], 500);
        }

        try {
            $result = $tianque->nativePrepay($order, $this->rechargeDescription($quote), $clientIp);
            $order->code_url = $result['payUrl'];
            $order->wx_transaction_id = $result['uuid'];
            $order->save();
        } catch (\Throwable $e) {
            Log::error('[payment] tianque recharge nativePrepay failed: ' . $e->getMessage());
            $order->status = PaymentOrder::STATUS_FAILED;
            $order->remark = '[recharge] tianque error: ' . mb_substr($e->getMessage(), 0, 200);
            $order->save();
            return response()->json(['error' => '天阙支付下单失败：' . $e->getMessage()], 502);
        }

        return response()->json($this->formatOrderForClient($order, false), 201);
    }

    private function rechargeDescription(array $quote): string
    {
        $label = ($quote['balance_type'] ?? '') === 'token'
            ? (string) \App\Models\SystemSetting::getValue('currency_label_token', '金币')
            : (string) \App\Models\SystemSetting::getValue('currency_label_credit', '积分');
        return $label . '充值';
    }

    /**
     * 复用未过期、同渠道、且到账明细完全一致的直充 pending 订单。
     * 直充金额可变，故必须比对 snapshot（类型/支付金额/到账/赠送/档位）完全相同才复用，
     * 避免用户改了金额却命中旧金额订单。
     */
    private function findReusableRechargeOrder(int $userId, string $channel, array $quote, ?string $oemProjectKey): ?PaymentOrder
    {
        $query = PaymentOrder::where('user_id', $userId)
            ->where('channel', $channel)
            ->where('order_type', PaymentOrder::TYPE_RECHARGE)
            ->where('status', PaymentOrder::STATUS_PENDING)
            ->where('expires_at', '>', now());
        if ($oemProjectKey) {
            $query->where('oem_project_key', $oemProjectKey);
        } else {
            $query->whereNull('oem_project_key');
        }

        foreach ($query->orderByDesc('id')->get() as $order) {
            $snap = (array) $order->plan_snapshot;
            if (
                (string) ($snap['balance_type'] ?? '') === (string) $quote['balance_type']
                && (int) ($snap['package_id'] ?? 0) === (int) ($quote['package_id'] ?? 0)
                && $this->floatEq((float) ($snap['pay_amount'] ?? 0), (float) $quote['pay_amount'])
                && $this->floatEq((float) ($snap['base_amount'] ?? 0), (float) $quote['base_amount'])
                && $this->floatEq((float) ($snap['bonus_amount'] ?? 0), (float) $quote['bonus_amount'])
            ) {
                return $order;
            }
        }
        return null;
    }

    private function floatEq(float $a, float $b): bool
    {
        return abs($a - $b) < 0.00001;
    }

    // ============== Admin APIs ==============

    public function adminIndex(Request $request)
    {
        // 列表只取必要字段，notify_payload / plan_snapshot / code_url 等大字段在详情接口再返回
        $query = PaymentOrder::query()
            ->select([
                'id', 'order_no', 'user_id', 'plan_id', 'amount', 'currency', 'channel',
                'oem_project_key', 'commission_user_id', 'commission_rate_snapshot', 'commission_amount', 'commission_status',
                'order_type', 'status', 'wx_transaction_id', 'user_plan_id', 'upgrade_from_user_plan_id',
                'paid_at', 'closed_at', 'expires_at', 'created_at',
            ])
            ->with(['user:id,username,nickname', 'plan:id,code,name']);

        if ($request->filled('status'))   $query->where('status', $request->status);
        if ($request->filled('order_type')) $query->where('order_type', $request->order_type);
        if ($request->filled('oem_project_key')) $query->where('oem_project_key', $request->oem_project_key);
        if ($request->filled('commission_status')) $query->where('commission_status', $request->commission_status);
        if ($request->filled('user_id'))  $query->where('user_id', $request->user_id);
        if ($request->filled('plan_id'))  $query->where('plan_id', $request->plan_id);
        if ($request->filled('order_no')) $query->where('order_no', 'like', '%' . $request->order_no . '%');
        if ($request->filled('start_date')) {
            $query->where('created_at', '>=', $request->start_date . ' 00:00:00');
        }
        if ($request->filled('end_date')) {
            $query->where('created_at', '<=', $request->end_date . ' 23:59:59');
        }

        // 附加 derived_status：pending 但已过期显示为 expired，便于管理端筛选与展示
        $data = $query->orderByDesc('id')
            ->paginate($request->get('per_page', 50));
        $items = collect($data->items())->map(function ($order) {
                /** @var PaymentOrder $order */
                $arr = $order->toArray();
                $arr['derived_status'] = $order->derivedStatus();
                $arr['oem_project_name'] = $order->oem_project_key
                    ? DB::table('oem_projects')->where('project_key', $order->oem_project_key)->value('name')
                    : null;
                $arr['commission_user'] = $order->commission_user_id
                    ? DB::table('users')->where('id', $order->commission_user_id)->first(['id', 'username', 'nickname'])
                    : null;
                return $arr;
            });
        return response()->json([
            'data' => $items,
            'total' => $data->total(),
            'current_page' => $data->currentPage(),
            'per_page' => $data->perPage(),
        ]);
    }

    public function adminShow($id)
    {
        $order = PaymentOrder::with(['user:id,username,nickname', 'plan:id,code,name', 'userPlan:id,status', 'commissionRecord'])
            ->findOrFail($id);
        // 附加 derived_status，与列表保持一致（pending 且过期展示为 expired）
        $arr = $order->toArray();
        $arr['derived_status'] = $order->derivedStatus();
        $arr['oem_project'] = $order->oem_project_key
            ? DB::table('oem_projects')->where('project_key', $order->oem_project_key)->first(['project_key', 'name', 'app_name', 'status'])
            : null;
        $arr['commission_user'] = $order->commission_user_id
            ? DB::table('users')->where('id', $order->commission_user_id)->first(['id', 'username', 'nickname'])
            : null;
        return response()->json($arr);
    }

    /**
     * 管理员删除无效订单。
     *
     * 仅允许删除终态且无资金影响的订单：closed / failed / expired（pending 且已过期）。
     * 严格拒绝：
     *   - pending：可能正在支付，删掉会丢状态；需先 cancel / sync 确定终态
     *   - paid / refunded：有资金流水，强制留档审计
     * 删除仅针对订单记录本身，不触碰已发放的 user_plans / 余额日志。
     */
    public function adminDestroy($id)
    {
        /** @var PaymentOrder $order */
        $order = PaymentOrder::findOrFail($id);
        $derived = $order->derivedStatus();

        $allowed = [PaymentOrder::STATUS_CLOSED, PaymentOrder::STATUS_FAILED, 'expired'];
        if (!in_array($derived, $allowed, true)) {
            return response()->json([
                'error' => '仅可删除无效订单（已关闭 / 失败 / 已超时）。当前状态：' . $derived,
            ], 400);
        }

        $order->delete();
        return response()->json(['message' => 'Deleted', 'order_no' => $order->order_no]);
    }

    /**
     * 主动调微信查单同步状态（容灾）。
     */
    public function adminSync($id, WeChatPayService $wxpay, TianquePayService $tianque, XunhupayService $xunhupay, PlanService $planService)
    {
        /** @var PaymentOrder $order */
        $order = PaymentOrder::findOrFail($id);
        $channel = (string) $order->channel;

        // 按渠道查单：微信(trade_state) / 天阙(tranSts) / 虎皮椒(status) 的成功、失败码各不相同
        try {
            if ($channel === 'tianque_native') {
                $tx = $tianque->queryOrder($order->order_no);
                $stateLabel = (string)($tx['tranSts'] ?? '');
                $paid   = $stateLabel === 'SUCCESS';
                $failed = in_array($stateLabel, ['FAIL', 'CLOSED', 'CANCELED'], true);
            } elseif ($channel === 'xunhupay_native') {
                $tx = $xunhupay->queryOrder($order->order_no);
                $stateLabel = (string)($tx['status'] ?? '');
                $paid   = $stateLabel === 'OD';
                $failed = $stateLabel === 'CD';
            } else {
                $tx = $wxpay->queryOrder($order->order_no);
                $stateLabel = (string)($tx['trade_state'] ?? '');
                $paid   = $stateLabel === 'SUCCESS';
                $failed = in_array($stateLabel, ['CLOSED', 'REVOKED', 'PAYERROR'], true);
            }
        } catch (\Throwable $e) {
            return response()->json(['error' => '查单失败：' . $e->getMessage()], 502);
        }

        if ($order->status === PaymentOrder::STATUS_PENDING && $paid) {
            // 已支付但本地尚为 pending，补单。事务内 lockForUpdate 复检状态防与回调竞态
            try {
                DB::transaction(function () use ($order, $tx, $planService, $channel) {
                    $fresh = PaymentOrder::where('id', $order->id)->lockForUpdate()->first();
                    if (!$fresh || $fresh->status !== PaymentOrder::STATUS_PENDING) {
                        // 回调/客户端 sync 已结算该订单，跳过补单避免重复发放
                        return;
                    }
                    if ($channel === 'tianque_native') {
                        $this->settleTianquePaidOrder($fresh, $tx, $planService, '[admin_sync]');
                    } elseif ($channel === 'xunhupay_native') {
                        $this->settleXunhupayPaidOrder($fresh, $tx, $planService, '[admin_sync]');
                    } else {
                        $this->settlePaidOrder($fresh, $tx, $planService, '[admin_sync]');
                    }
                });
            } catch (\Throwable $e) {
                return response()->json(['error' => '补单失败：' . $e->getMessage()], 500);
            }
            $order->refresh();
        } elseif ($order->status === PaymentOrder::STATUS_PENDING && $failed) {
            // 同样加锁复检，避免与其他路径（用户 cancel / 定时任务）同时切换状态
            try {
                DB::transaction(function () use ($order) {
                    $fresh = PaymentOrder::where('id', $order->id)->lockForUpdate()->first();
                    if (!$fresh || $fresh->status !== PaymentOrder::STATUS_PENDING) return;
                    PaymentOrder::assertTransition($fresh->status, PaymentOrder::STATUS_CLOSED);
                    $fresh->status    = PaymentOrder::STATUS_CLOSED;
                    $fresh->closed_at = now();
                    $fresh->save();
                });
            } catch (\Throwable $e) {
                return response()->json(['error' => '关单失败：' . $e->getMessage()], 500);
            }
            $order->refresh();
        }

        return response()->json([
            'wx_trade_state' => $stateLabel,
            'local_status'   => $order->status,
            'order'          => $order->fresh(['user:id,username,nickname', 'plan:id,code,name']),
        ]);
    }

    // ============== Helpers ==============

    /**
     * 结算「已支付」状态的订单：金额校验 + 取用户 + 发放套餐 + 状态切换。
     * 调用方需在事务 + lockForUpdate 上下文中执行；失败抛异常以回滚。
     */
    private function settlePaidOrder(
        PaymentOrder $order,
        array $tx,
        PlanService $planService,
        string $remarkPrefix
    ): void {
        // 金额校验（微信 amount.total 单位为分）
        $wxTotal    = (int)($tx['amount']['total'] ?? -1);
        $orderCents = (int)bcmul((string)$order->amount, '100', 0);
        if ($wxTotal !== $orderCents) {
            Log::error("[payment] amount mismatch order={$order->order_no} wx={$wxTotal} order={$orderCents}");
            throw new \RuntimeException('amount mismatch');
        }

        $user = $order->user()->first();
        if (!$user) {
            Log::error("[payment] order user missing order={$order->order_no} user_id={$order->user_id}");
            throw new \RuntimeException('user missing');
        }

        if ($order->order_type === PaymentOrder::TYPE_RECHARGE) {
            app(RechargeService::class)->fulfill($order, $user, $remarkPrefix);
            $userPlan = null;
        } elseif ($order->order_type === PaymentOrder::TYPE_RENEW) {
            $renewUserPlan = UserPlan::where('id', (int)$order->upgrade_from_user_plan_id)
                ->where('user_id', $user->id)
                ->first();
            if (!$renewUserPlan) {
                throw new \RuntimeException('renew source plan missing');
            }
            $userPlan = $planService->renewFromSnapshot($user, $renewUserPlan, (array)$order->plan_snapshot, [
                'remark' => sprintf('%s %s', $remarkPrefix, $order->order_no),
            ]);
        } elseif ($order->order_type === PaymentOrder::TYPE_UPGRADE) {
            $fromUserPlan = UserPlan::where('id', (int)$order->upgrade_from_user_plan_id)
                ->where('user_id', $user->id)
                ->first();
            if (!$fromUserPlan) {
                throw new \RuntimeException('upgrade source plan missing');
            }
            $userPlan = $planService->upgradeFromSnapshot($user, $fromUserPlan, (array)$order->plan_snapshot, [
                'remark' => sprintf('%s %s', $remarkPrefix, $order->order_no),
            ]);
        } else {
            $userPlan = $planService->grantFromSnapshot($user, (array)$order->plan_snapshot, [
                'source' => 'purchase',
                'remark' => sprintf('%s %s', $remarkPrefix, $order->order_no),
            ]);
        }

        // 状态机校验 + 更新订单
        PaymentOrder::assertTransition($order->status, PaymentOrder::STATUS_PAID);
        $order->status            = PaymentOrder::STATUS_PAID;
        $order->paid_at           = now();
        $order->wx_transaction_id = (string)($tx['transaction_id'] ?? '');
        $order->user_plan_id      = $userPlan?->id;
        $order->save();
        app(OemChannelService::class)->settleCommission($order);
    }

    /**
     * 构造套餐快照（订单创建时一次性固化）。
     */
    private function buildSnapshot(Plan $plan): array
    {
        $modelIds = $plan->modelAssignments->pluck('cloud_model_id')->map(fn($v) => (int)$v)->values()->all();
        $policies = [];
        foreach ($plan->permissions as $pp) {
            $policies[$pp->policy_key] = json_decode((string)$pp->policy_value, true);
        }
        return [
            'plan_id'       => (int)$plan->id,
            'code'          => (string)$plan->code,
            'name'          => (string)$plan->name,
            'duration_days' => (int)$plan->duration_days,
            'token_quota'   => (float)$plan->token_quota,
            'credit_quota'  => (float)$plan->credit_quota,
            'storage_quota_bytes' => (int)($plan->storage_quota_bytes ?? 0),
            'quota_refill_cycle' => (string)($plan->quota_refill_cycle ?? 'none'),
            'rate_limit'     => is_array($plan->rate_limit_json) ? $plan->rate_limit_json : [],
            'model_ids'     => $modelIds,
            'policies'      => $policies,
        ];
    }

    /**
     * 客户端响应格式：隐藏 notify_payload 等内部字段。
     */
    private function formatOrderForClient(PaymentOrder $order, bool $reused): array
    {
        $snap = (array)$order->plan_snapshot;
        return [
            'order_no'     => $order->order_no,
            'amount'       => (string)$order->amount,
            'currency'     => $order->currency,
            'code_url'     => $order->code_url,
            'expires_at'   => optional($order->expires_at)->toIso8601String(),
            'paid_at'      => optional($order->paid_at)->toIso8601String(),
            'closed_at'    => optional($order->closed_at)->toIso8601String(),
            'status'       => $order->derivedStatus(),
            'user_plan_id' => $order->user_plan_id,
            'order_type'   => $order->order_type ?: PaymentOrder::TYPE_PURCHASE,
            'upgrade_from_user_plan_id' => $order->upgrade_from_user_plan_id ? (int)$order->upgrade_from_user_plan_id : null,
            'plan'         => [
                'id'            => (int)($snap['plan_id'] ?? $order->plan_id),
                'code'          => (string)($snap['code'] ?? ''),
                'name'          => (string)($snap['name'] ?? ''),
                'duration_days' => (int)($snap['duration_days'] ?? 0),
                'quota_refill_cycle' => (string)($snap['quota_refill_cycle'] ?? 'none'),
            ],
            'recharge'     => (($snap['kind'] ?? '') === 'recharge') ? [
                'balance_type' => (string)($snap['balance_type'] ?? ''),
                'pay_amount'   => (float)($snap['pay_amount'] ?? $order->amount),
                'base_amount'  => (float)($snap['base_amount'] ?? 0),
                'bonus_amount' => (float)($snap['bonus_amount'] ?? 0),
                'total_amount' => (float)($snap['total_amount'] ?? 0),
            ] : null,
            'reused'       => $reused,
        ];
    }

    private function findRenewableUserPlan(int $userId, int $planId): ?UserPlan
    {
        return UserPlan::where('user_id', $userId)
            ->where('plan_id', $planId)
            ->where('status', 'active')
            ->where(function ($q) {
                $q->whereNull('expires_at')->orWhere('expires_at', '>', now());
            })
            ->orderByRaw('expires_at IS NULL DESC')
            ->orderByDesc('expires_at')
            ->orderByDesc('id')
            ->first();
    }

    /**
     * 计算运行时回调地址。
     *
     * 优先读 config('app.url')（即 APP_URL 环境变量）防止攻击者伪造 Host 头。
     * 未配置或仅配为 Laravel 默认 http://localhost 时，降级使用请求 Host（开发环境兼容）。
     *
     * 出口强制 https：微信 V3 API 强制要求 notify_url 是 https://，
     * 但客户场景常见 (1) 反代终结 SSL 后 PHP-FPM 看到的是 http，
     * (2) 装站时是 http 后来才上 SSL，APP_URL 仍记为 http://。
     * 与 AgentBuildClient 中 origin scheme 规范化思路一致，无条件改写为 https，
     * 站点本身没 SSL 的情况本就不能用微信支付，与本逻辑无关。
     */
    private function buildNotifyUrl(Request $request): string
    {
        $base = (string) config('app.url', '');
        if ($base === '' || $base === 'http://localhost') {
            $base = $request->getSchemeAndHttpHost();
        }
        $base = preg_replace('#^http://#i', 'https://', $base) ?? $base;
        return rtrim($base, '/') . '/api/payment/wechat/notify';
    }
}
