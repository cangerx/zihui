<?php

namespace App\Console\Commands;

use App\Services\Build\GitHubDispatchService;
use App\Services\Build\QuotaService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class BuildStuckDetector extends Command
{
    protected $signature = 'build:stuck-detector';
    protected $description = 'building 超过 20min 的 build → 调 GitHub 查 + 必要时 cancel + 退配额';

    public function handle(GitHubDispatchService $github, QuotaService $quota): int
    {
        if (\App\Services\Build\BuildPackaging::retired()) {
            $this->warn('[BuildPackaging] retired, skip');
            return 0;
        }

        $cutoff = now()->subMinutes(20);

        $stuck = DB::table('build_requests')
            ->where('status', 'building')
            ->where('started_at', '<', $cutoff)
            ->get();

        $this->info('[BuildStuckDetector] found ' . $stuck->count() . ' stuck builds');

        foreach ($stuck as $b) {
            $createdDate = date('Y-m-d', strtotime($b->created_at));

            if (!$b->executor_run_id) {
                // 没 run_id 无从 cancel，直接 fail
                $this->line('  ' . $b->build_id . ' has no run_id, marking failed');
                DB::table('build_requests')->where('build_id', $b->build_id)->update([
                    'status' => 'failed',
                    'error_message' => 'stuck_no_run_id',
                    'finished_at' => now(),
                    'updated_at' => now(),
                ]);
                $quota->decrDailyCount($b->client_id, $createdDate);
                continue;
            }

            // 尝试 cancel GitHub run
            $this->line('  cancelling run=' . $b->executor_run_id . ' for ' . $b->build_id);
            $cancelled = $github->cancelRun((int) $b->executor_run_id);

            DB::table('build_requests')->where('build_id', $b->build_id)->update([
                'status' => $cancelled ? 'cancelled' : 'failed',
                'error_message' => $cancelled ? 'stuck_cancelled_by_cron' : 'stuck_cancel_failed',
                'finished_at' => now(),
                'updated_at' => now(),
            ]);
            $quota->decrDailyCount($b->client_id, $createdDate);
        }

        $this->info('[BuildStuckDetector] done');
        return 0;
    }
}
