<?php

namespace App\Console\Commands;

use App\Services\SystemSetting\SettingService;
use Illuminate\Console\Command;

/**
 * 0.5.0：旋转 / 初始化家庭电脑 mirror worker 的 Bearer token。
 *
 * 用法：
 *   php artisan mirror:rotate-worker-token         → 生成新 token，覆盖旧值，打印到 stdout
 *   php artisan mirror:rotate-worker-token --show  → 仅打印当前已有 token（不旋转）
 *
 * 不暴露给 admin UI。理由：减少攻击面，避免登录 admin 后台的人通过 UI 拿走 token
 * 滥用 mirror 接口（mirror 接口可拉所有 build 的 release_tag / SFTP URL）。
 *
 * 输出格式：
 *   [mirror:worker-token] new token (KEEP SECRET):
 *   <64-char hex>
 *   [mirror:worker-token] copy to home computer .env: AGENT_BUILD_WORKER_TOKEN=<token>
 */
class MirrorRotateWorkerToken extends Command
{
    protected $signature = 'mirror:rotate-worker-token {--show : 仅打印当前 token 不旋转}';
    protected $description = '生成 / 旋转家庭电脑 mirror worker 鉴权 token (system_settings.mirror.worker_token)';

    public function handle(SettingService $settings): int
    {
        if ($this->option('show')) {
            $current = (string) $settings->get('mirror', 'worker_token', '');
            if ($current === '') {
                $this->error('[mirror:worker-token] not configured yet. Run without --show to generate one.');
                return 1;
            }
            $this->line('[mirror:worker-token] current token:');
            $this->line($current);
            return 0;
        }

        // 64 char hex (32 bytes entropy) 与 callback_token 同强度
        $newToken = bin2hex(random_bytes(32));

        $settings->setGroup('mirror', [
            'worker_token' => $newToken,
        ], ['worker_token']);

        $this->info('[mirror:worker-token] new token (KEEP SECRET):');
        $this->line($newToken);
        $this->info('[mirror:worker-token] copy to home computer .env:');
        $this->line('AGENT_BUILD_WORKER_TOKEN=' . $newToken);
        return 0;
    }
}
