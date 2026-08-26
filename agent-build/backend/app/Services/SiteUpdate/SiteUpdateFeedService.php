<?php

namespace App\Services\SiteUpdate;

use App\Models\SiteUpdateRelease;
use Illuminate\Support\Facades\Storage;

class SiteUpdateFeedService
{
    public function publicBaseUrl(): string
    {
        return rtrim((string) config('app.url'), '/');
    }

    public function zipUrl(SiteUpdateRelease $row): string
    {
        $override = trim((string) ($row->zip_url ?? ''));
        if ($override !== '') {
            return $override;
        }

        return $this->publicBaseUrl() . '/api/updates/' . rawurlencode((string) $row->channel)
            . '/packages/' . rawurlencode((string) $row->version) . '.zip';
    }

    public function changelogLines(?string $raw): array
    {
        $raw = trim((string) $raw);
        if ($raw === '') {
            return [];
        }
        $lines = preg_split('/\r\n|\r|\n/', $raw) ?: [];
        $out = [];
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            $out[] = ltrim($line, "-• \t");
        }

        return $out !== [] ? $out : [$raw];
    }

    public function versionJson(string $channel = SiteUpdateRelease::CHANNEL_ADMIN): array
    {
        $current = SiteUpdateRelease::query()
            ->where('channel', $channel)
            ->where('is_current', 1)
            ->orderByDesc('id')
            ->first();

        if ($current === null) {
            return [
                'latest' => '0.0.0',
                'min_upgradable_from' => '0.0.0',
                'zip_url' => '',
                'sha256' => '',
                'size' => 0,
                'released_at' => '',
                'breaking' => false,
                'changelog' => [],
                'releases_url' => $this->publicBaseUrl() . '/api/updates/' . rawurlencode($channel) . '/releases.json',
                'previous_versions' => [],
            ];
        }

        return [
            'latest' => (string) $current->version,
            'min_upgradable_from' => (string) ($current->min_upgradable_from ?: $current->version),
            'zip_url' => $this->zipUrl($current),
            'sha256' => (string) ($current->sha256 ?? ''),
            'size' => (int) $current->size,
            'released_at' => optional($current->released_at)->toIso8601String() ?: '',
            'breaking' => (bool) $current->breaking,
            'changelog' => $this->changelogLines($current->changelog),
            'releases_url' => $this->publicBaseUrl() . '/api/updates/' . rawurlencode($channel) . '/releases.json',
            'previous_versions' => [],
        ];
    }

    public function releasesJson(string $channel = SiteUpdateRelease::CHANNEL_ADMIN): array
    {
        $rows = SiteUpdateRelease::query()
            ->where('channel', $channel)
            ->orderByDesc('id')
            ->get();

        $releases = [];
        foreach ($rows as $row) {
            $releases[] = [
                'version' => (string) $row->version,
                'released_at' => optional($row->released_at)->toIso8601String() ?: '',
                'breaking' => (bool) $row->breaking,
                'changelog' => $this->changelogLines($row->changelog),
                'size' => (int) $row->size,
                'sha256' => (string) ($row->sha256 ?? ''),
                'zip_url' => $this->zipUrl($row),
            ];
        }

        return [
            'schema_version' => 1,
            'updated_at' => now()->toIso8601String(),
            'releases' => $releases,
        ];
    }

    public function localZipAbsolutePath(SiteUpdateRelease $row): ?string
    {
        $path = (string) ($row->zip_path ?? '');
        if ($path === '') {
            return null;
        }
        $full = Storage::disk('local')->path($path);
        return is_file($full) ? $full : null;
    }
}
