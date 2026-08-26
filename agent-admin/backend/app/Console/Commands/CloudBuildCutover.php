<?php

namespace App\Console\Commands;

use App\Services\CloudBuild\CloudBuildCutoverService;
use Illuminate\Console\Command;
use InvalidArgumentException;

class CloudBuildCutover extends Command
{
    protected $signature = 'cloud-build:cutover
        {action : status|freeze|unfreeze|drain|pause-workers|resume-workers|record-cursor|switch-backend|health|rollback}
        {--backend= : switch-backend 目标 local|remote}
        {--timeout=0 : drain 最长等待秒数，0 只检查一次}
        {--poll=5 : drain 轮询间隔秒}
        {--after-build-id= : 记录最终增量游标}
        {--until= : 记录最终增量时间上界}
        {--for=status : health 档案 status|pre-switch|post-switch|post-rollback}';

    protected $description = '客户端打包冻结/排空/切换/回滚工具（T5.2，不执行生产切换）';

    public function handle(CloudBuildCutoverService $cutover): int
    {
        $action = (string) $this->argument('action');
        try {
            $report = $this->runAction($cutover, $action);
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage());
            return 1;
        }

        $this->line(json_encode($report, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

        $ok = (bool) ($report['ok'] ?? false);
        if ($ok) {
            $this->info('CLOUD_BUILD_CUTOVER_OK');
            return 0;
        }

        $stop = (string) ($report['stop'] ?? implode(',', $report['stop_conditions'] ?? ['failed']));
        $this->error('CLOUD_BUILD_CUTOVER_STOP: ' . $stop);
        return 2;
    }

    /**
     * @return array<string, mixed>
     */
    private function runAction(CloudBuildCutoverService $cutover, string $action): array
    {
        if ($action === 'status') {
            return $cutover->status();
        }
        if ($action === 'freeze') {
            return $cutover->freeze();
        }
        if ($action === 'unfreeze') {
            return $cutover->unfreeze();
        }
        if ($action === 'pause-workers') {
            return $cutover->pauseWorkers();
        }
        if ($action === 'resume-workers') {
            return $cutover->resumeWorkers();
        }
        if ($action === 'drain') {
            return $cutover->drain((int) $this->option('timeout'), (int) $this->option('poll'));
        }
        if ($action === 'record-cursor') {
            return $cutover->recordCursor(
                (string) $this->option('after-build-id'),
                $this->option('until') ? (string) $this->option('until') : null
            );
        }
        if ($action === 'switch-backend') {
            $target = (string) $this->option('backend');
            if ($target === '') {
                throw new InvalidArgumentException('--backend=local|remote is required');
            }
            return $cutover->switchBackend($target);
        }
        if ($action === 'health') {
            return $cutover->health((string) $this->option('for'), $this->secretsPresent());
        }
        if ($action === 'rollback') {
            return $cutover->rollback();
        }

        throw new InvalidArgumentException('unknown action: ' . $action);
    }

    /**
     * 只报告是否已配置，不输出值。
     *
     * @return array<string, bool>
     */
    private function secretsPresent(): array
    {
        return [
            'github_token' => trim((string) config('cloudbuild.github.token')) !== '',
            'github_repo' => trim((string) config('cloudbuild.github.repo')) !== '',
            'callback_url' => trim((string) (config('cloudbuild.github.callback_url') ?: '')) !== '',
            'sign_secret' => trim((string) config('cloudbuild.download.sign_secret')) !== '',
            'worker_token' => trim((string) config('cloudbuild.mirror.worker_token')) !== '',
        ];
    }
}
