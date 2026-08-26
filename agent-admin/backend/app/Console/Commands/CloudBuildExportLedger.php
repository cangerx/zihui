<?php

namespace App\Console\Commands;

use App\Models\CloudBuildArtifact;
use App\Models\CloudBuildClient;
use App\Models\CloudBuildJob;
use App\Models\CloudBuildQuota;
use App\Models\CloudBuildTemplate;
use App\Services\CloudBuild\CloudBuildLedgerFile;
use Illuminate\Console\Command;

/**
 * 从云控执行账本导出 target 形态 ledger，便于备份或与源文件对照。不读取授权端。
 */
class CloudBuildExportLedger extends Command
{
    protected $signature = 'cloud-build:export-ledger
        {file : 输出 JSON 路径}
        {--after-build-id= : 从该 build_id 之后导出（不含）}
        {--limit=0 : 本批最多条数，0 表示全部}';

    protected $description = '导出云控本地执行账本为 ledger v1（脱敏）';

    public function handle(): int
    {
        $after = (string) $this->option('after-build-id');
        $limit = (int) $this->option('limit');

        $query = CloudBuildJob::query()->orderBy('build_id');
        if ($after !== '') {
            $query->where('build_id', '>', $after);
        }
        if ($limit > 0) {
            $query->limit($limit);
        }
        $jobs = $query->get();

        $sourceShaped = [];
        foreach ($jobs as $job) {
            $arts = CloudBuildArtifact::query()->where('build_id', $job->build_id)->get()->map(fn ($a) => [
                'filename' => $a->filename,
                'role' => $a->role,
                'size' => (int) $a->size,
                'sha256' => $a->sha256,
            ])->all();
            $sourceShaped[] = [
                'build_id' => $job->build_id,
                'client_ref' => $job->client_ref,
                'platform' => $job->platform,
                'build_mode' => $job->build_mode,
                'oem_project_key' => $job->oem_project_key,
                'status' => $job->source_status ?: $job->phase,
                'mirror_status' => $job->source_mirror_status,
                'dispatch_attempts' => (int) $job->dispatch_attempts,
                'executor_run_id' => $job->executor_run_id,
                'app_name' => $job->app_name,
                'app_version' => $job->app_version,
                'artifacts' => $arts,
            ];
        }

        $clients = CloudBuildClient::query()->orderBy('client_ref')->get()->map(fn ($c) => [
            'client_ref' => $c->client_ref,
            'domain' => $c->domain,
            'daily_limit' => (int) $c->daily_limit,
            'monthly_limit' => (int) $c->monthly_limit,
            'status' => $c->status,
            'expires_at' => $c->expires_at?->toDateTimeString(),
            'maintenance_exempt' => (int) $c->maintenance_exempt,
        ])->all();
        $templates = CloudBuildTemplate::query()->orderBy('version')->get()->map(fn ($t) => [
            'version' => $t->version,
            'released_at' => $t->released_at?->toDateTimeString(),
            'changelog' => $t->changelog,
            'is_current' => (int) $t->is_current,
            'released_by' => $t->released_by,
        ])->all();
        $quotas = CloudBuildQuota::query()->orderBy('client_ref')->orderBy('quota_date')->get()->map(fn ($q) => [
            'client_ref' => $q->client_ref,
            'quota_date' => optional($q->quota_date)->toDateString() ?? (string) $q->quota_date,
            'consumed' => (int) $q->consumed,
        ])->all();

        $hasMore = false;
        $next = $jobs->last()?->build_id;
        if ($limit > 0 && $next) {
            $hasMore = CloudBuildJob::query()->where('build_id', '>', $next)->exists();
        }

        $packed = CloudBuildLedgerFile::pack($sourceShaped, $clients, $templates, $quotas, gmdate('c'), [
            'after_build_id' => $after,
            'limit' => $limit,
            'has_more' => $hasMore,
            'next_after_build_id' => $next,
        ]);

        $path = (string) $this->argument('file');
        $dir = dirname($path);
        if ($dir !== '' && $dir !== '.' && !is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        file_put_contents($path, json_encode($packed, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n");
        $this->info('[CloudBuildExportLedger] jobs=' . count($sourceShaped) . ' file=' . $path);
        return 0;
    }
}
