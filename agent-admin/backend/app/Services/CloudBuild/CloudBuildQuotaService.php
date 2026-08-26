<?php

namespace App\Services\CloudBuild;

use App\Models\CloudBuildQuota;
use Carbon\Carbon;

class CloudBuildQuotaService
{
    public function getDailyCount(string $clientRef, string $date): int
    {
        $row = CloudBuildQuota::query()
            ->where('client_ref', $clientRef)
            ->whereDate('quota_date', $date)
            ->first();

        return $row ? (int) $row->consumed : 0;
    }

    public function incrDailyCount(string $clientRef, string $date): int
    {
        return (int) CloudBuildQuota::query()->getConnection()->transaction(function () use ($clientRef, $date) {
            /** @var CloudBuildQuota|null $row */
            $row = CloudBuildQuota::query()
                ->where('client_ref', $clientRef)
                ->whereDate('quota_date', $date)
                ->lockForUpdate()
                ->first();

            if ($row === null) {
                $row = CloudBuildQuota::query()->create([
                    'client_ref' => $clientRef,
                    'quota_date' => $date,
                    'consumed' => 1,
                ]);
                return (int) $row->consumed;
            }

            $row->consumed = (int) $row->consumed + 1;
            $row->save();
            return (int) $row->consumed;
        });
    }

    /**
     * 退 1 次；SQLite/MySQL 均用 PHP 下限 0，避免 GREATEST。
     */
    public function decrDailyCount(string $clientRef, string $date): int
    {
        return (int) CloudBuildQuota::query()->getConnection()->transaction(function () use ($clientRef, $date) {
            /** @var CloudBuildQuota|null $row */
            $row = CloudBuildQuota::query()
                ->where('client_ref', $clientRef)
                ->whereDate('quota_date', $date)
                ->lockForUpdate()
                ->first();

            if ($row === null || (int) $row->consumed <= 0) {
                return 0;
            }

            $row->consumed = max(0, (int) $row->consumed - 1);
            $row->save();
            return (int) $row->consumed;
        });
    }

    public static function quotaDateFrom(mixed $createdAt): string
    {
        if ($createdAt) {
            return Carbon::parse($createdAt)->toDateString();
        }
        return Carbon::now()->toDateString();
    }
}
