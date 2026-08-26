<?php

namespace App\Services\Build;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class BuildLedgerExportService
{
    public function __construct(private BuildLedgerExportMapper $mapper)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function export(string $afterBuildId = '', int $limit = 0, ?string $until = null): array
    {
        if (!Schema::hasTable('build_requests')) {
            return $this->mapper->pack([], [], [], [], [
                'after_build_id' => $afterBuildId,
                'limit' => $limit,
                'has_more' => false,
            ], $until);
        }

        $q = DB::table('build_requests')->orderBy('build_id');
        if ($afterBuildId !== '') {
            $q->where('build_id', '>', $afterBuildId);
        }
        if ($until) {
            $q->where('created_at', '<=', $until);
        }
        if ($limit > 0) {
            $q->limit($limit);
        }
        $requests = $q->get();

        $jobs = [];
        $clientIds = [];
        foreach ($requests as $row) {
            $mapped = $this->mapper->mapRequest($row);
            $jobs[] = $mapped;
            if ($mapped['client_ref'] !== '') {
                $clientIds[$mapped['client_ref']] = true;
            }
        }

        $hasMore = false;
        $next = $jobs !== [] ? (string) $jobs[count($jobs) - 1]['build_id'] : null;
        if ($limit > 0 && $next) {
            $more = DB::table('build_requests')->where('build_id', '>', $next);
            if ($until) {
                $more->where('created_at', '<=', $until);
            }
            $hasMore = $more->exists();
        }

        $clients = [];
        if (Schema::hasTable('authorized_clients') && $clientIds !== []) {
            foreach (DB::table('authorized_clients')->whereIn('client_id', array_keys($clientIds))->orderBy('client_id')->get() as $client) {
                $clients[] = $this->mapper->mapClient($client);
            }
        }

        $quotas = [];
        if (Schema::hasTable('build_quotas') && $clientIds !== []) {
            foreach (DB::table('build_quotas')->whereIn('client_id', array_keys($clientIds))->orderBy('client_id')->orderBy('date')->get() as $quota) {
                $quotas[] = $this->mapper->mapQuota($quota);
            }
        }

        $templates = [];
        if (Schema::hasTable('template_versions')) {
            foreach (DB::table('template_versions')->orderBy('version')->get() as $template) {
                $templates[] = $this->mapper->mapTemplate($template);
            }
        }

        return $this->mapper->pack($jobs, $clients, $templates, $quotas, [
            'after_build_id' => $afterBuildId,
            'limit' => $limit,
            'has_more' => $hasMore,
            'next_after_build_id' => $next,
        ], $until);
    }
}
