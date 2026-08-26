<?php

namespace App\Console\Commands;

use App\Services\PlanService;
use Illuminate\Console\Command;

class ExpirePlans extends Command
{
    protected $signature = 'plan:expire {--limit=500 : Max plans to expire per run}';
    protected $description = 'Expire active user plans that have passed expires_at';

    public function handle(PlanService $service)
    {
        $limit = (int)$this->option('limit');
        $expirable = $service->findExpirable($limit);

        if ($expirable->isEmpty()) {
            $this->info('No plans to expire.');
            return 0;
        }

        $count = 0;
        foreach ($expirable as $userPlan) {
            try {
                $service->expire($userPlan);
                $count++;
            } catch (\Throwable $e) {
                $this->error(sprintf(
                    'Failed to expire user_plan #%d: %s',
                    $userPlan->id,
                    $e->getMessage()
                ));
            }
        }

        $this->info("Expired {$count} user plan(s).");
        return 0;
    }
}
