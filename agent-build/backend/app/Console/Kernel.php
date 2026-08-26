<?php

namespace App\Console;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;

class Kernel extends ConsoleKernel
{
    /**
     * Define the application's command schedule.
     *
     * @param  \Illuminate\Console\Scheduling\Schedule  $schedule
     * @return void
     */
    protected function schedule(Schedule $schedule)
    {
        // T5.3：打包调度默认下线；紧急回切 BUILD_PACKAGING_RETIRED=false。
        if (!\App\Services\Build\BuildPackaging::retired()) {
            $schedule->command('build:dispatch-pending')->everyMinute()->withoutOverlapping()->runInBackground();
            $schedule->command('build:worker --once')->everyMinute()->withoutOverlapping()->runInBackground();
            $schedule->command('build:ack-timeout')->hourly();
            $schedule->command('build:stuck-detector')->everyFiveMinutes();
            $schedule->command('build:mirror-watchdog')->everyFiveMinutes()->withoutOverlapping()->runInBackground();
        }
        // 授权请求日志体积控制（安全网，兜底中间件内的抽样裁剪）：每小时把成功记录裁到最新 500 条。
        // 被拒记录不在此清理、全部保留，由管理端「清空」按钮手动清理。
        $schedule->command('auth-log:prune')->hourly()->withoutOverlapping()->runInBackground();
    }

    /**
     * Register the commands for the application.
     *
     * @return void
     */
    protected function commands()
    {
        $this->load(__DIR__.'/Commands');

        require base_path('routes/console.php');
    }
}
