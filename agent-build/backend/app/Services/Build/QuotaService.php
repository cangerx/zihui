<?php

namespace App\Services\Build;

use Illuminate\Support\Facades\DB;

class QuotaService
{
    /**
     * 获取客户某日打包次数
     */
    public function getDailyCount(string $clientId, string $date): int
    {
        $row = DB::table('build_quotas')
            ->where('client_id', $clientId)
            ->where('date', $date)
            ->first();

        return $row ? (int) $row->count : 0;
    }

    /**
     * 客户某日打包次数 +1
     * Phase B-N: DB 层实现（未接 Redis）
     * 后续切 Redis INCR 原子扣减
     */
    public function incrDailyCount(string $clientId, string $date): void
    {
        $existing = DB::table('build_quotas')
            ->where('client_id', $clientId)
            ->where('date', $date)
            ->first();

        $now = now();

        if ($existing) {
            DB::table('build_quotas')
                ->where('id', $existing->id)
                ->update([
                    'count' => DB::raw('count + 1'),
                    'updated_at' => $now,
                ]);
        } else {
            DB::table('build_quotas')->insert([
                'client_id' => $clientId,
                'date' => $date,
                'count' => 1,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    /**
     * 退还客户某日配额 -1（最小 0）
     * 用于 cancel / failed 状态时调用
     */
    public function decrDailyCount(string $clientId, string $date): void
    {
        $existing = DB::table('build_quotas')
            ->where('client_id', $clientId)
            ->where('date', $date)
            ->first();

        if ($existing && $existing->count > 0) {
            DB::table('build_quotas')
                ->where('id', $existing->id)
                ->update([
                    'count' => DB::raw('GREATEST(count - 1, 0)'),
                    'updated_at' => now(),
                ]);
        }
    }
}
