<?php

namespace App\Console;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;

class Kernel extends ConsoleKernel
{
    protected function schedule(Schedule $schedule)
    {
        // 过期用户套餐：每 10 分钟翻转一次 status（原每小时滞后过大，到期后最长 1 小时
        // 才把存储 status 置为 expired）。注意：实际权益闸门按 expires_at 实时判定，
        // 前端状态徽标也已实时派生，此任务仅负责把存储 status 字段尽快对齐。
        $schedule->command('plan:expire')
            ->everyTenMinutes()
            ->withoutOverlapping()
            ->runInBackground();

        // 月度续充：每 30 分钟扫描一次到期续充点（原每小时，重置时刻最长滞后 1 小时；
        // 改 30 分钟把"按月重置"的延迟窗口收窄到 ≤30 分钟）。
        $schedule->command('plan:refill-monthly-quotas')
            ->everyThirtyMinutes()
            ->withoutOverlapping()
            ->runInBackground();

        // Close expired pending payment orders every 5 minutes
        $schedule->command('order:close-expired')
            ->everyFiveMinutes()
            ->withoutOverlapping()
            ->runInBackground();

        // CloudBuild: pull pending artifacts every minute
        $schedule->command('cloud-build:pull --once')->everyMinute()->withoutOverlapping()->runInBackground();

        // T4.2 本地执行：GitHub 未配置时 dispatch 内部跳过，不影响现有 pull。
        $schedule->command('cloud-build:dispatch-pending')->everyMinute()->withoutOverlapping()->runInBackground();
        $schedule->command('cloud-build:ack-timeout')->hourly()->withoutOverlapping();
        $schedule->command('cloud-build:stuck-detector')->everyFiveMinutes()->withoutOverlapping();
        $schedule->command('cloud-build:fetch-artifacts')->everyMinute()->withoutOverlapping()->runInBackground();
        $schedule->command('cloud-build:cleanup-orphans')->daily()->withoutOverlapping();

        // 共享灵感库状态同步：每 5 分钟一次，把本地分享过的灵感的 hub 状态对齐 hub 端。
        // 命令内部检查 inspiration_hub_enabled，关闭时直接 noop，无需在此判断。
        $schedule->command('inspiration-hub:sync-status')
            ->everyFiveMinutes()
            ->withoutOverlapping()
            ->runInBackground();

        $schedule->command('creative-template-hub:sync-status')
            ->everyFiveMinutes()
            ->withoutOverlapping()
            ->runInBackground();

        $schedule->command('agent-hub:sync-status')
            ->everyFiveMinutes()
            ->withoutOverlapping()
            ->runInBackground();

        $schedule->command('skill-catalog:sync')
            ->everyFiveMinutes()
            ->withoutOverlapping()
            ->runInBackground();

        // 健康探测：按 config('gateway.probe_interval_minutes') 频率（默认 5 分钟）跑一次基础探测。
        // GET /models 不消耗 token；写 cloud_provider_metrics 时间序列；连续失败 N 次自动熔断。
        // 间隔取值钳制 1-60 分钟，避免误填非法 cron 表达式让 schedule:run 整体崩。
        $probeInterval = max(1, min(60, (int) config('gateway.probe_interval_minutes', 5)));
        $schedule->command('providers:probe')
            ->cron("*/{$probeInterval} * * * *")
            ->withoutOverlapping()
            ->runInBackground();

        // 视频任务兜底结算：每分钟扫描「停滞」的非终态任务主动 refresh，
        // 即使 PollVideoTaskJob 链式轮询中断（tries=1 单次异常 / sync 模式 PHP 超时）也能在
        // 任务完成时 chargeAndRecord 扣费（billing_status 幂等，重复安全），保证「完成必扣」。
        $schedule->command('video:settle-pending')
            ->everyMinute()
            ->withoutOverlapping()
            ->runInBackground();

        // 临时参考素材过期清理：每小时把 expires_at 过期（默认留 60min 宽限）的素材连同
        // COS / 本地文件一并删除，避免桌面端上传的视频参考图无限堆积成孤儿文件。
        $schedule->command('video:purge-reference-assets')
            ->hourly()
            ->withoutOverlapping()
            ->runInBackground();

        $schedule->command('assets:purge-expired')
            ->hourly()->withoutOverlapping()->runInBackground();

        // 云同步容量对账：每小时重算 used_bytes，纠正增量维护漂移。
        $schedule->command('sync:reconcile-storage')
            ->hourly()
            ->withoutOverlapping()
            ->runInBackground();

        // 云同步 blob 回收：每小时清理无引用且超宽限期的媒体 blob（删文件 + DB + 容量）。
        $schedule->command('sync:gc-blobs')
            ->hourly()
            ->withoutOverlapping()
            ->runInBackground();

        // 云同步上传临时目录回收：每日清理断点续传中途放弃残留的分块目录。
        $schedule->command('sync:purge-tmp')
            ->daily()
            ->withoutOverlapping()
            ->runInBackground();

        // 图片任务兜底清理：每 5 分钟把卡在 pending/processing 的僵尸任务标 failed，并清理
        // 7 天前的历史记录。sync 模式下生图寄生 PHP-FPM 进程，被 request_terminate_timeout /
        // OOM 强杀时 ProcessImageTaskJob 来不及翻状态，任务会永久卡住（对应 video:settle-pending）。
        $schedule->command('image:purge-stale --keep-days=7')
            ->everyFiveMinutes()
            ->withoutOverlapping()
            ->runInBackground();

        // 文档批量导出 zip 残留清理：deleteFileAfterSend 处理「下载成功」场景，
        // 这里兜底「下载中断 / 异常导致文件未删」的情况。每小时扫一次 ≥ 1 小时的残留。
        $schedule->call(function () {
            $dir = storage_path('app/temp/doc-exports');
            if (!is_dir($dir)) return;
            $cutoff = time() - 3600;  // 1 小时前
            $entries = @scandir($dir) ?: [];
            foreach ($entries as $name) {
                if ($name === '.' || $name === '..') continue;
                $path = $dir . DIRECTORY_SEPARATOR . $name;
                if (!is_file($path)) continue;
                $mtime = @filemtime($path);
                if ($mtime !== false && $mtime < $cutoff) {
                    @unlink($path);
                }
            }
        })->hourly()->name('cleanup-doc-exports')->withoutOverlapping();
    }

    protected function commands()
    {
        $this->load(__DIR__.'/Commands');

        require base_path('routes/console.php');
    }
}
