<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * 控制 authorization_request_logs 体积：成功(allowed)记录滚动保留最新 --keep 条，
 * 删除更早的成功记录；被拒(denied)记录不在此清理、全部保留，由管理端「清空」按钮手动清理。
 *
 * 作为 VerifyDomainBinding 中间件内「抽样裁剪」的安全网，由 Kernel::schedule() 每小时调度。
 */
class PruneAuthorizationRequestLogs extends Command
{
    protected $signature = 'auth-log:prune {--keep=500}';

    protected $description = '裁剪 authorization_request_logs 的成功记录，仅保留最新 --keep 条（被拒记录全部保留）';

    public function handle(): int
    {
        $keep = max(0, (int) $this->option('keep'));

        // 取「第 keep+1 新」的成功记录 id 作为分界，删除其及更早的成功记录
        $cutoffId = DB::table('authorization_request_logs')
            ->where('result', 'allowed')
            ->orderByDesc('id')
            ->skip($keep)
            ->limit(1)
            ->value('id');

        $deleted = 0;
        if ($cutoffId) {
            $deleted = DB::table('authorization_request_logs')
                ->where('result', 'allowed')
                ->where('id', '<=', $cutoffId)
                ->delete();
        }

        $this->info('[auth-log:prune] deleted_allowed=' . $deleted . ' kept_newest=' . $keep);

        return 0;
    }
}
