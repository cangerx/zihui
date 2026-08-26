<?php

namespace App\Console\Commands;

use App\Services\PlanService;
use Illuminate\Console\Command;

class RefillMonthlyQuotasCommand extends Command
{
    protected $signature = 'plan:refill-monthly-quotas {--limit=500 : Max user plans to refill per run}';
    protected $description = 'Refill due monthly quota buckets for active subscription plans';

    public function handle(PlanService $service)
    {
        $limit = max(1, (int)$this->option('limit'));
        $plans = $service->findDueMonthlyRefills($limit);

        if ($plans->isEmpty()) {
            $this->info('No monthly quotas to refill.');
            return 0;
        }

        $success = 0;
        foreach ($plans as $userPlan) {
            try {
                $refilled = $service->refillMonthlyQuota($userPlan);
                if ($refilled) {
                    $success++;
                }
            } catch (\Throwable $e) {
                $this->error(sprintf(
                    'Failed to refill user_plan #%d: %s',
                    $userPlan->id,
                    $e->getMessage()
                ));
            }
        }

        $this->info("Refilled {$success} monthly user plan quota(s).");
        return 0;
    }
}
