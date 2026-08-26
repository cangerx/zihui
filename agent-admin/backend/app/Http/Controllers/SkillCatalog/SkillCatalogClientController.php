<?php

namespace App\Http\Controllers\SkillCatalog;

use App\Http\Controllers\Controller;
use App\Services\SkillCatalog\SkillCatalogService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class SkillCatalogClientController extends Controller
{
    public function __construct(private SkillCatalogService $catalog)
    {
    }

    public function catalog(Request $request): JsonResponse
    {
        $tenantId = (int) optional($request->user())->id;
        $cursor = (string) $request->query('cursor', '');
        return response()->json($this->catalog->clientCatalog($tenantId, $cursor));
    }

    public function downloadTicket(Request $request, string $versionId): JsonResponse
    {
        $tenantId = (int) optional($request->user())->id;
        $result = $this->catalog->clientDownloadTicket($versionId, $tenantId);
        if (($result['status'] ?? 200) !== 200) {
            return response()->json(['error' => $result['error']], (int) $result['status']);
        }
        return response()->json($result['body']);
    }

    public function download(string $token): BinaryFileResponse|JsonResponse
    {
        $result = $this->catalog->resolveDownload($token);
        if (($result['status'] ?? 200) !== 200) {
            return response()->json(['error' => $result['error']], (int) $result['status']);
        }
        return response()->download($result['path'], $result['filename'], [
            'Content-Type' => 'application/zip',
        ]);
    }
}
