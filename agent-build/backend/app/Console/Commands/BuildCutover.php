<?php

namespace App\Console\Commands;

use App\Services\Build\BuildCutoverService;
use Illuminate\Console\Command;
use InvalidArgumentException;

class BuildCutover extends Command
{
    protected $signature = 'build:cutover
        {action : status|freeze|unfreeze|drain|pause-workers|resume-workers|health|rollback}
        {--timeout=0 : drain 最长等待秒数，0 只检查一次}
        {--poll=5 : drain 轮询间隔秒}
        {--message= : freeze 时写入的维护文案}
        {--for=status : health 档案 status|pre-switch|post-rollback}';

    protected $description = '授权端打包冻结/排空/暂停 worker/回滚（T5.2，不执行生产切换）';

    public function handle(BuildCutoverService $cutover): int
    {
        $action = (string) $this->argument('action');
        try {
            $report = $this->runAction($cutover, $action);
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage());
            return 1;
        }

        $this->line(json_encode($report, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
        if (!empty($report['ok'])) {
            $this->info('BUILD_CUTOVER_OK');
            return 0;
        }

        $stop = implode(',', $report['stop_conditions'] ?? ['failed']);
        $this->error('BUILD_CUTOVER_STOP: ' . $stop);
        return 2;
    }

    /**
     * @return array<string, mixed>
     */
    private function runAction(BuildCutoverService $cutover, string $action): array
    {
        if ($action === 'status') {
            return $cutover->health('status', $this->secretsPresent());
        }
        if ($action === 'freeze') {
            $message = $this->option('message') ? (string) $this->option('message') : null;
            return $cutover->freeze($message);
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
        if ($action === 'health') {
            return $cutover->health((string) $this->option('for'), $this->secretsPresent());
        }
        if ($action === 'rollback') {
            return $cutover->rollback();
        }

        throw new InvalidArgumentException('unknown action: ' . $action);
    }

    /**
     * @return array<string, bool>
     */
    private function secretsPresent(): array
    {
        return [
            'github_token' => trim((string) config('build.github.token', '')) !== '',
            'github_repo' => trim((string) config('build.github.repo', '')) !== '',
        ];
    }
}
