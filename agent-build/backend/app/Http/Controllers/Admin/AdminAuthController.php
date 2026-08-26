<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AdminUser;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;

class AdminAuthController extends Controller
{
    /**
     * POST /admin/auth/login
     */
    public function login(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'username' => ['required', 'string', 'max:50'],
            'password' => ['required', 'string', 'min:6', 'max:100'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $user = AdminUser::where('username', $request->input('username'))->first();
        if (!$user || !Hash::check($request->input('password'), $user->password_hash)) {
            return response()->json(['error' => 'invalid_credentials'], 401);
        }

        if (!$user->is_active) {
            return response()->json(['error' => 'account_disabled'], 403);
        }

        $user->last_login_at = now();
        $user->save();

        // Sanctum 2.x: ['*'] 表示所有 abilities (Phase 2 可细分)
        $token = $user->createToken('admin-session', ['*'])->plainTextToken;

        return response()->json([
            'token' => $token,
            'user' => [
                'id' => $user->id,
                'username' => $user->username,
                'name' => $user->name,
                'role' => $user->role,
            ],
        ], 200);
    }

    /**
     * GET /admin/auth/me
     */
    public function me(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['error' => 'unauthenticated'], 401);
        }
        return response()->json([
            'id' => $user->id,
            'username' => $user->username,
            'name' => $user->name,
            'role' => $user->role,
            'last_login_at' => $user->last_login_at?->toIso8601String(),
        ], 200);
    }

    /**
     * POST /admin/auth/logout
     */
    public function logout(Request $request): JsonResponse
    {
        $token = $request->user()?->currentAccessToken();
        if ($token) {
            $token->delete();
        }
        return response()->json(['status' => 'logged_out'], 200);
    }
}
