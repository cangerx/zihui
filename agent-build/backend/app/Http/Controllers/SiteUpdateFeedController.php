<?php

namespace App\Http\Controllers;

use App\Models\SiteUpdateRelease;
use App\Services\SiteUpdate\SiteUpdateFeedService;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\Response;

class SiteUpdateFeedController extends Controller
{
    public function version(string $channel, SiteUpdateFeedService $feed): JsonResponse
    {
        $channel = $this->normalizeChannel($channel);

        return response()->json($feed->versionJson($channel), 200);
    }

    public function releases(string $channel, SiteUpdateFeedService $feed): JsonResponse
    {
        $channel = $this->normalizeChannel($channel);

        return response()->json($feed->releasesJson($channel), 200);
    }

    public function package(string $channel, string $version, SiteUpdateFeedService $feed): Response
    {
        $channel = $this->normalizeChannel($channel);
        $version = preg_replace('/\.zip$/i', '', $version) ?? $version;
        $row = SiteUpdateRelease::query()
            ->where('channel', $channel)
            ->where('version', $version)
            ->first();
        if ($row === null) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $abs = $feed->localZipAbsolutePath($row);
        if ($abs === null) {
            if (trim((string) $row->zip_url) !== '') {
                return redirect()->away((string) $row->zip_url);
            }

            return response()->json(['error' => 'package_missing'], 404);
        }

        return new BinaryFileResponse($abs, 200, [
            'Content-Type' => 'application/zip',
            'Content-Disposition' => 'attachment; filename="agent-admin-' . $version . '.zip"',
        ]);
    }

    private function normalizeChannel(string $channel): string
    {
        return $channel === SiteUpdateRelease::CHANNEL_ADMIN ? $channel : SiteUpdateRelease::CHANNEL_ADMIN;
    }
}
