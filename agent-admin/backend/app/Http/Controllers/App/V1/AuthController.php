<?php

namespace App\Http\Controllers\App\V1;

use App\Models\User;
use App\Models\UserBalance;
use App\Support\AppV1Response;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Tymon\JWTAuth\Exceptions\JWTException;
use Tymon\JWTAuth\Exceptions\TokenExpiredException;
use Tymon\JWTAuth\Exceptions\TokenInvalidException;
use Tymon\JWTAuth\Facades\JWTAuth;

class AuthController
{
    public function login(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'identifier' => ['nullable', 'string', 'max:100'],
            'username' => ['nullable', 'string', 'max:100'],
            'email' => ['nullable', 'email', 'max:100'],
            'password' => ['required', 'string', 'min:6', 'max:100'],
        ]);
        if ($validator->fails()) {
            return AppV1Response::error('validation_error', $validator->errors()->first(), 422);
        }

        $identifier = trim((string) ($request->input('identifier')
            ?: $request->input('username')
            ?: $request->input('email')));
        if ($identifier === '') {
            return AppV1Response::error('validation_error', '请输入用户名或邮箱', 422);
        }

        $user = User::query()->where(function ($query) use ($identifier) {
            $query->where('username', $identifier)->orWhere('email', $identifier);
        })->first();

        if (!$user || !Hash::check((string) $request->input('password'), (string) $user->password)) {
            return AppV1Response::error('invalid_credentials', '用户名或密码错误', 401);
        }
        if ($user->status !== 'active') {
            return AppV1Response::error('account_disabled', '账号已被禁用，请联系管理员', 403);
        }

        $user->forceFill(['last_login_at' => now()])->saveQuietly();

        return $this->tokenResponse(JWTAuth::fromUser($user), $user);
    }

    public function register(Request $request)
    {
        if (!\App\Models\SystemSetting::getValue('register_enabled', true)) {
            return AppV1Response::error('registration_disabled', '当前暂未开放注册', 403);
        }

        $validator = Validator::make($request->all(), [
            'email' => ['required', 'email', 'max:100', 'unique:users,email'],
            'password' => ['required', 'string', 'min:6', 'max:100'],
            'nickname' => ['required', 'string', 'min:2', 'max:50'],
            'username' => ['nullable', 'string', 'min:6', 'max:50', 'regex:/^[a-zA-Z0-9_]+$/', 'unique:users,username'],
        ]);
        if ($validator->fails()) {
            return AppV1Response::error('validation_error', $validator->errors()->first(), 422);
        }

        $username = trim((string) ($request->input('username') ?: strstr((string) $request->input('email'), '@', true)));
        $username = preg_replace('/[^a-zA-Z0-9_]/', '', $username) ?: 'user';
        $username = substr($username, 0, 42);
        while (strlen($username) < 6) $username .= '0';
        if (User::where('username', $username)->exists()) {
            $username = substr($username, 0, 35) . '_' . bin2hex(random_bytes(4));
        }

        $user = DB::transaction(function () use ($request, $username) {
            $user = User::create([
                'username' => $username,
                'email' => trim((string) $request->input('email')),
                'password' => Hash::make((string) $request->input('password')),
                'nickname' => trim((string) $request->input('nickname')),
                'role' => 'user',
                'status' => 'active',
            ]);
            UserBalance::create(['user_id' => $user->id, 'balance_type' => 'token', 'amount' => 0]);
            UserBalance::create(['user_id' => $user->id, 'balance_type' => 'credit', 'amount' => 0]);
            return $user;
        });

        return $this->tokenResponse(JWTAuth::fromUser($user), $user, 201);
    }

    public function me()
    {
        return AppV1Response::ok(AppV1Response::user(auth()->user()));
    }

    public function refresh(Request $request)
    {
        try {
            $rawToken = $request->bearerToken();
            if (!$rawToken) return AppV1Response::error('token_missing', 'Token not provided', 401);
            $token = JWTAuth::setToken($rawToken)->refresh();
            $user = JWTAuth::setToken($token)->authenticate();
            if (!$user || $user->status !== 'active') {
                return AppV1Response::error('account_disabled', '账号不可用', 403);
            }
            return $this->tokenResponse($token, $user);
        } catch (TokenExpiredException|TokenInvalidException|JWTException $exception) {
            return AppV1Response::error('token_invalid', '登录状态已失效，请重新登录', 401);
        }
    }

    public function logout()
    {
        try {
            $token = JWTAuth::getToken();
            if ($token) JWTAuth::invalidate($token);
        } catch (\Throwable $exception) {
            try {
                Log::warning('App v1 logout token invalidation failed', [
                    'user_id' => auth()->id(),
                    'exception' => $exception::class,
                ]);
            } catch (\Throwable) {
                // Logging must not replace the versioned fail-closed response.
            }

            return AppV1Response::error(
                'logout_failed',
                '服务端登录状态暂时无法注销，请稍后重试',
                503
            );
        }
        return AppV1Response::ok(null);
    }

    private function tokenResponse(string $token, User $user, int $status = 200)
    {
        return AppV1Response::ok([
            'access_token' => $token,
            'token_type' => 'Bearer',
            'expires_in' => (int) config('jwt.ttl', 1440) * 60,
            'refresh_expires_in' => (int) config('jwt.refresh_ttl', 20160) * 60,
            'user' => AppV1Response::user($user),
        ], $status);
    }
}
