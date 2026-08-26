<?php

namespace App\Support;

use Illuminate\Http\JsonResponse;

class AppV1Response
{
    public static function ok(mixed $data, int $status = 200, array $meta = []): JsonResponse
    {
        return response()->json([
            'data' => $data,
            'meta' => array_merge([
                'request_id' => (string) request()->attributes->get('request_id', ''),
            ], $meta),
        ], $status);
    }

    public static function error(string $code, string $message, int $status, array $details = []): JsonResponse
    {
        $error = ['code' => $code, 'message' => $message];
        if ($details !== []) {
            $error['details'] = $details;
        }

        return response()->json([
            'error' => $error,
            'meta' => [
                'request_id' => (string) request()->attributes->get('request_id', ''),
            ],
        ], $status);
    }

    public static function user($user): array
    {
        $user->loadMissing('balances');

        return [
            'id' => (int) $user->id,
            'username' => (string) $user->username,
            'email' => $user->email,
            'phone' => $user->phone,
            'nickname' => (string) ($user->nickname ?: $user->username),
            'avatar' => $user->avatar ?? null,
            'role' => (string) $user->role,
            'status' => (string) $user->status,
            'balances' => $user->balances->map(fn ($balance) => [
                'type' => (string) $balance->balance_type,
                'amount' => (float) $balance->amount,
            ])->values()->all(),
            'created_at' => optional($user->created_at)->toISOString(),
        ];
    }
}
