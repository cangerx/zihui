<?php

namespace App\Services\Hub;

/**
 * 审核员云控整库同步时：提交直接过审，且不受每日条数上限挡住。
 * 普通云控仍走 pending + 日限额。
 */
class HubReviewerSubmitPolicy
{
    public static function isReviewer(?object $client): bool
    {
        return (bool) ($client->is_hub_reviewer ?? false);
    }

    public static function initialStatus(?object $client): string
    {
        return self::isReviewer($client) ? 'approved' : 'pending';
    }

    public static function bypassDailyLimit(?object $client): bool
    {
        return self::isReviewer($client);
    }
}
