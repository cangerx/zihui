<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Models\UserBalance;
use App\Models\UserGroup;
use App\Models\Plan;
use App\Models\SystemSetting;
use App\Services\BalanceService;
use App\Services\OemChannelService;
use App\Services\PlanService;
use App\Services\Sms\SmsCodeService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Tymon\JWTAuth\Exceptions\JWTException;
use Tymon\JWTAuth\Exceptions\TokenExpiredException;
use Tymon\JWTAuth\Exceptions\TokenInvalidException;
use Tymon\JWTAuth\Facades\JWTAuth;

class AuthController extends Controller
{
    public function register(Request $request)
    {
        if (!SystemSetting::getValue('register_enabled', true)) {
            return response()->json(['error' => '当前暂未开放注册，请联系管理员'], 403);
        }

        // 注册短信验证：需「短信总开关」+「注册短信验证开关」同时开启才生效
        $smsVerify = (bool) SystemSetting::getValue('sms_enabled', false)
            && (bool) SystemSetting::getValue('register_sms_verify_enabled', false);

        // 用户名/昵称统一字符集：英文 / 数字 / 中文 / 下划线
        // 长度策略：username 6-16，nickname 2-30，nickname 全局 unique
        $nameRegex = '/^[a-zA-Z0-9_\x{4e00}-\x{9fa5}]+$/u';

        $rules = [
            'username' => ['required', 'string', 'min:6', 'max:16', 'regex:' . $nameRegex, 'unique:users,username'],
            'password' => 'required|string|min:6|max:100',
            'email' => 'nullable|email|unique:users,email',
            'nickname' => ['nullable', 'string', 'min:2', 'max:30', 'regex:' . $nameRegex, 'unique:users,nickname'],
        ];
        if ($smsVerify) {
            // 开启短信验证：手机号必填、格式校验、全局唯一，并要求短信验证码
            $rules['phone'] = ['required', 'regex:/^1[3-9]\d{9}$/', 'unique:users,phone'];
            $rules['code']  = ['required', 'string'];
        } else {
            // 未开启：手机号选填，但只要填写就必须全局唯一（数据库已加唯一索引）
            $rules['phone'] = ['nullable', 'string', 'max:20', 'unique:users,phone'];
        }

        $validator = Validator::make($request->all(), $rules, [
            'username.required' => '请输入用户名',
            'username.min' => '用户名长度需 6-16 个字符',
            'username.max' => '用户名长度需 6-16 个字符',
            'username.regex' => '用户名只能包含中文 / 英文 / 数字 / 下划线',
            'username.unique' => '该用户名已被注册',
            'password.required' => '请输入密码',
            'password.min' => '密码至少 6 个字符',
            'password.max' => '密码最多 100 个字符',
            'email.email' => '邮箱格式不正确',
            'email.unique' => '该邮箱已被使用',
            'phone.required' => '请输入手机号',
            'phone.regex' => '手机号格式不正确',
            'phone.unique' => '该手机号已被注册',
            'code.required' => '请输入短信验证码',
            'nickname.min' => '昵称长度需 2-30 个字符',
            'nickname.max' => '昵称长度需 2-30 个字符',
            'nickname.regex' => '昵称只能包含中文 / 英文 / 数字 / 下划线',
            'nickname.unique' => '该昵称已被使用',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        // 短信验证码校验（仅在开启注册短信验证时）
        if ($smsVerify && !app(SmsCodeService::class)->verify(SmsCodeService::SCENE_REGISTER, (string) $request->phone, (string) $request->code)) {
            return response()->json(['error' => '验证码错误或已过期'], 422);
        }

        $deviceId = substr((string)$request->header('X-Device-Id', ''), 0, 64);
        $registerIp = substr((string)$request->ip(), 0, 45);
        $registerOemProjectKey = app(OemChannelService::class)->captureRegisterSource($request);

        // 注册策略：新用户默认是否开通「灵感大王」权限（系统设置 → 注册策略 → 新用户默认权限）
        $defaultInspirationUploader = (bool) SystemSetting::getValue('register_default_inspiration_uploader', false);

        $user = User::create([
            'username' => $request->username,
            'password' => Hash::make($request->password),
            'email' => $request->email,
            'phone' => $request->filled('phone') ? trim((string) $request->phone) : null,
            'nickname' => $request->nickname ?? $request->username,
            'role' => 'user',
            'status' => 'active',
            'register_ip' => $registerIp,
            'register_device_id' => $deviceId ?: null,
            'register_oem_project_key' => $registerOemProjectKey,
            'inspiration_uploader' => $defaultInspirationUploader,
        ]);

        UserBalance::create(['user_id' => $user->id, 'balance_type' => 'token', 'amount' => 0]);
        UserBalance::create(['user_id' => $user->id, 'balance_type' => 'credit', 'amount' => 0]);

        // \u5355\u5206\u7ec4\u72ec\u5360\u7b56\u7565\uff1a\u53ea\u53d6\u7b2c\u4e00\u4e2a\u9ed8\u8ba4\u5206\u7ec4\uff08\u6309 id \u5347\u5e8f\uff09
        $defaultGroupId = UserGroup::where('is_default', true)->orderBy('id')->value('id');
        if ($defaultGroupId) {
            $user->groups()->sync([$defaultGroupId]);
        }

        // Apply register bonus (non-blocking)
        $bonus = null;
        try {
            $bonus = $this->applyRegisterBonus($user, $deviceId, $registerIp);
        } catch (\Throwable $e) {
            Log::warning('[register] bonus failed: ' . $e->getMessage());
        }

        $token = JWTAuth::fromUser($user);
        $user->refresh();
        $user->load('balances');

        return response()->json([
            'token' => $token,
            'token_type' => 'bearer',
            'expires_in' => config('jwt.ttl') * 60,
            'user' => $this->formatUser($user),
            'bonus' => $bonus,
        ], 201);
    }

    /**
     * Apply register bonus based on system settings.
     * Returns bonus summary or null if not granted.
     */
    private function applyRegisterBonus(User $user, string $deviceId, string $ip): ?array
    {
        $settings = SystemSetting::getAll();
        if (empty($settings['register_bonus_enabled'])) return null;

        $tokenBonus  = (float)($settings['register_bonus_token'] ?? 0);
        $creditBonus = (float)($settings['register_bonus_credit'] ?? 0);
        $planId      = $settings['register_bonus_plan_id'] ?? null;
        $remark      = (string)($settings['register_bonus_remark'] ?? '新用户注册赠送');
        $ipDaily     = (int)($settings['register_ip_daily_limit'] ?? 0);
        $deviceOnce  = !empty($settings['register_device_unique']);

        // Device unique check (查 users.register_device_id，排除当前用户自己)
        if ($deviceOnce && $deviceId !== '') {
            $deviceGranted = User::where('register_device_id', $deviceId)
                ->where('id', '!=', $user->id)
                ->exists();
            if ($deviceGranted) {
                Log::info("[register] skip bonus: device {$deviceId} already granted");
                return ['granted' => false, 'reason' => 'device_already_granted'];
            }
        }

        // Per-IP daily limit (查 users.register_ip 当日新注册数，排除当前用户自己)
        if ($ipDaily > 0 && $ip !== '') {
            $today = now()->startOfDay();
            $ipCount = User::where('register_ip', $ip)
                ->where('id', '!=', $user->id)
                ->where('created_at', '>=', $today)
                ->count();
            if ($ipCount >= $ipDaily) {
                Log::info("[register] skip bonus: ip {$ip} exceeded daily limit {$ipDaily}");
                return ['granted' => false, 'reason' => 'ip_daily_limit'];
            }
        }

        $result = ['granted' => true, 'token' => 0.0, 'credit' => 0.0, 'plan_id' => null, 'user_plan_id' => null];
        $logRemark = '[register] device=' . ($deviceId ?: '-') . ' ip=' . ($ip ?: '-') . ' ' . $remark;

        DB::transaction(function () use ($user, $tokenBonus, $creditBonus, &$result, $logRemark) {
            if ($tokenBonus > 0) {
                app(BalanceService::class)->addWallet($user->id, 'token', $tokenBonus, 'register_bonus', $logRemark);
                $result['token'] = $tokenBonus;
            }
            if ($creditBonus > 0) {
                app(BalanceService::class)->addWallet($user->id, 'credit', $creditBonus, 'register_bonus', $logRemark);
                $result['credit'] = $creditBonus;
            }
        });

        if ($planId) {
            $plan = Plan::find((int)$planId);
            if ($plan && $plan->status === 'active') {
                try {
                    $userPlan = app(PlanService::class)->grant($user, $plan, [
                        'source' => 'register',
                        'remark' => $logRemark,
                    ]);
                    $result['plan_id']      = (int)$planId;
                    $result['user_plan_id'] = $userPlan?->id;
                } catch (\Throwable $e) {
                    Log::warning('[register] plan grant failed: ' . $e->getMessage());
                }
            } else {
                Log::info("[register] plan #{$planId} missing or archived, skipped");
            }
        }

        return $result;
    }

    public function login(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'username' => 'required|string',
            'password' => 'required|string',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $user = User::where('username', $request->username)->first();

        if (!$user || !Hash::check($request->password, $user->password)) {
            return response()->json(['error' => '用户名或密码错误'], 401);
        }

        if ($user->status !== 'active') {
            return response()->json(['error' => '账号已被禁用，请联系管理员'], 403);
        }

        // 注意：登录接口对桌面端 + 管理后台共用，不在此处限制 role。
        // 管理后台 admin 校验由前端 Login 页面在拿到 user 后判定，并由 admin 路由组的 AdminOnly 中间件兜底。
        $token = JWTAuth::fromUser($user);

        // 记录最后登录时间；不走 update event，避免触碰 updated_at 影响其他逻辑
        $user->forceFill(['last_login_at' => now()])->saveQuietly();

        return response()->json([
            'token' => $token,
            'token_type' => 'bearer',
            'expires_in' => config('jwt.ttl') * 60,
            'user' => $this->formatUser($user),
        ]);
    }

    public function logout()
    {
        JWTAuth::invalidate(JWTAuth::getToken());
        return response()->json(['message' => 'Logged out']);
    }

    public function refresh()
    {
        try {
            $rawToken = JWTAuth::getToken();
            if (!$rawToken) {
                return response()->json(['error' => 'Token not provided'], 401);
            }
            $token = JWTAuth::setToken($rawToken)->refresh();
        } catch (TokenExpiredException $e) {
            return response()->json(['error' => 'Token expired'], 401);
        } catch (TokenInvalidException $e) {
            return response()->json(['error' => 'Token invalid'], 401);
        } catch (JWTException $e) {
            return response()->json(['error' => 'Token not provided'], 401);
        }

        return response()->json([
            'token' => $token,
            'token_type' => 'bearer',
            'expires_in' => config('jwt.ttl') * 60,
        ]);
    }

    public function me()
    {
        $user = auth()->user();
        $user->load('groups', 'balances');
        return response()->json($this->formatUser($user));
    }

    public function changePassword(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'old_password' => 'required|string',
            'new_password' => 'required|string|min:6|max:100',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $user = auth()->user();

        if (!Hash::check($request->old_password, $user->password)) {
            return response()->json(['error' => '原密码不正确'], 400);
        }

        $user->password = Hash::make($request->new_password);
        $user->save();

        return response()->json(['message' => 'Password changed']);
    }

    /**
     * 发送短信验证码（公开端点，注册 / 找回密码共用）。
     * body: { scene: 'register'|'reset_password', mobile }
     */
    public function sendSmsCode(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'scene'  => 'required|string|in:register,reset_password',
            'mobile' => 'required|string',
        ], [
            'scene.required'  => '缺少场景参数',
            'scene.in'        => '场景不合法',
            'mobile.required' => '请输入手机号',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $scene  = (string) $request->scene;
        $mobile = trim((string) $request->mobile);

        if (!SmsCodeService::isMobile($mobile)) {
            return response()->json(['error' => '手机号格式不正确'], 422);
        }
        if (!SystemSetting::getValue('sms_enabled', false)) {
            return response()->json(['error' => '短信服务未开启'], 403);
        }

        // 场景级开关 + 手机号占用预校验（提前拦截，避免走完流程才报错）
        if ($scene === SmsCodeService::SCENE_REGISTER) {
            if (!SystemSetting::getValue('register_enabled', true)) {
                return response()->json(['error' => '当前暂未开放注册'], 403);
            }
            if (!SystemSetting::getValue('register_sms_verify_enabled', false)) {
                return response()->json(['error' => '当前未开启注册短信验证'], 403);
            }
            if (User::where('phone', $mobile)->exists()) {
                return response()->json(['error' => '该手机号已注册'], 422);
            }
        } else {
            if (!SystemSetting::getValue('forgot_password_enabled', false)) {
                return response()->json(['error' => '当前未开启找回密码'], 403);
            }
            if (!User::where('phone', $mobile)->exists()) {
                return response()->json(['error' => '该手机号未注册'], 422);
            }
        }

        $result = app(SmsCodeService::class)->send($scene, $mobile);
        if (!($result['ok'] ?? false)) {
            $status = isset($result['retry_after']) ? 429 : 400;
            return response()->json(['error' => $result['message'] ?? '短信发送失败'], $status);
        }

        return response()->json([
            'message'    => '验证码已发送',
            'expires_in' => $result['expires_in'] ?? 300,
        ]);
    }

    /**
     * 凭手机号 + 验证码重置密码（公开端点，找回密码）。
     * 重置成功不自动登录，由前端引导用户使用新密码登录。
     */
    public function resetPassword(Request $request)
    {
        if (!SystemSetting::getValue('forgot_password_enabled', false)) {
            return response()->json(['error' => '当前未开启找回密码'], 403);
        }

        $validator = Validator::make($request->all(), [
            'mobile'       => 'required|string',
            'code'         => 'required|string',
            'new_password' => 'required|string|min:6|max:100',
        ], [
            'mobile.required'       => '请输入手机号',
            'code.required'         => '请输入验证码',
            'new_password.required' => '请输入新密码',
            'new_password.min'      => '密码至少 6 个字符',
            'new_password.max'      => '密码最多 100 个字符',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $mobile = trim((string) $request->mobile);
        if (!SmsCodeService::isMobile($mobile)) {
            return response()->json(['error' => '手机号格式不正确'], 422);
        }

        $user = User::where('phone', $mobile)->orderBy('id')->first();
        if (!$user) {
            return response()->json(['error' => '该手机号未注册'], 422);
        }

        if (!app(SmsCodeService::class)->verify(SmsCodeService::SCENE_RESET, $mobile, (string) $request->code)) {
            return response()->json(['error' => '验证码错误或已过期'], 422);
        }

        $user->password = Hash::make($request->new_password);
        $user->save();

        return response()->json(['message' => '密码重置成功，请使用新密码登录']);
    }

    private function formatUser($user)
    {
        return [
            'id' => $user->id,
            'username' => $user->username,
            'email' => $user->email,
            'phone' => $user->phone,
            'nickname' => $user->nickname,
            'role' => $user->role,
            'status' => $user->status,
            'register_oem_project_key' => $user->register_oem_project_key ?? null,
            'groups' => $user->relationLoaded('groups') ? $user->groups->map(fn($g) => [
                'id' => $g->id, 'name' => $g->name,
            ]) : [],
            'balances' => $user->relationLoaded('balances') ? $user->balances->map(fn($b) => [
                'type' => $b->balance_type, 'amount' => (float)$b->amount,
            ]) : [],
            'created_at' => $user->created_at,
        ];
    }
}
