<?php

namespace App\Http\Controllers;

use App\Services\SkillRegistry\SkillRegistryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use InvalidArgumentException;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class SkillRegistryPublicController extends Controller
{
    public function __construct(private SkillRegistryService $registry)
    {
    }

    public function events(Request $request): JsonResponse
    {
        $after = max(0, (int) $request->query('after', 0));
        $limit = (int) $request->query('limit', 100);
        try {
            return response()->json($this->registry->events($after, $limit));
        } catch (InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 409);
        }
    }

    public function downloadTicket(string $versionId): JsonResponse
    {
        $result = $this->registry->downloadTicket($versionId);
        if (($result['status'] ?? 200) !== 200) {
            return response()->json(['error' => $result['error']], (int) $result['status']);
        }
        return response()->json($result['body']);
    }

    public function download(string $token): BinaryFileResponse|JsonResponse
    {
        $result = $this->registry->resolveDownload($token);
        if (($result['status'] ?? 200) !== 200) {
            return response()->json(['error' => $result['error']], (int) $result['status']);
        }
        return response()->download($result['path'], $result['filename'], [
            'Content-Type' => 'application/zip',
        ]);
    }
}
