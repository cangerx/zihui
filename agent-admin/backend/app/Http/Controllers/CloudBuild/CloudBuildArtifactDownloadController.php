<?php

namespace App\Http\Controllers\CloudBuild;

use App\Http\Controllers\Controller;
use App\Services\CloudBuild\CloudBuildDownloadCatalogService;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\Response;

class CloudBuildArtifactDownloadController extends Controller
{
    public function download(Request $request, string $token, CloudBuildDownloadCatalogService $catalog): Response
    {
        $result = $catalog->resolveFile($token);
        if ($result['status'] !== 200 || $result['path'] === null) {
            return response()->json(['error' => $result['error'] ?? 'forbidden'], $result['status']);
        }

        return new BinaryFileResponse($result['path'], 200, [
            'Content-Type' => 'application/octet-stream',
            'Content-Disposition' => 'attachment; filename="' . addslashes((string) $result['filename']) . '"',
        ]);
    }
}
