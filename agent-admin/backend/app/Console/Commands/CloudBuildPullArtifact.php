<?php

namespace App\Console\Commands;

use App\Services\CloudBuild\CloudBuildPullService;
use App\Services\CloudBuild\OemBuildPullService;
use Illuminate\Console\Command;

/**
 * 1.2.0 起改为 pull 模式：本命令是 cron 模式（推荐技术用户给客户配；非必需）。
 *
 * 详细业务流水（resolve URL → download → atomic place → ack）封装在
 * CloudBuildPullService::pullPending()。控制器 CloudBuildController::refresh
 * 共用同一份逻辑实现「按需触发」（用户打开详情页/前端轮询时）。
 */
class CloudBuildPullArtifact extends Command
{
    protected $signature = 'cloud-build:pull {--once : process pending then exit}';
    protected $description = '主动轮询 agent-build 拉取就绪 artifact（cron 可选；用户打开详情页也会自动触发）';

    public function handle(CloudBuildPullService $service, OemBuildPullService $oemService): int
    {
        $once = (bool) $this->option('once');
        $this->info('[CloudBuildPull] started ' . now()->toDateTimeString() . ($once ? ' (once)' : ' (loop)'));

        do {
            $delivered = $service->pullPending(5);
            $oemDelivered = $oemService->pullPending(5);
            $delivered += $oemDelivered;
            if ($delivered > 0) {
                $this->info("  delivered {$delivered} build(s), oem={$oemDelivered}");
            }
            if ($once) {
                $this->info('[CloudBuildPull] once mode done, delivered=' . $delivered);
                return 0;
            }
            if ($delivered === 0) sleep(5);
        } while (true);
    }
}
