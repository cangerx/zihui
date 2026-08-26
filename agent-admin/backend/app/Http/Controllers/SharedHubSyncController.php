<?php

namespace App\Http\Controllers;

use App\Models\SystemSetting;
use App\Services\AgentHub\AgentHubClient;
use App\Services\CreativeTemplateHub\CreativeTemplateHubClient;
use App\Services\InspirationHub\InspirationHubClient;
use App\Services\SharedHub\DesktopInspirationImportService;
use App\Services\SharedHub\SharedHubSyncService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SharedHubSyncController extends Controller
{
    public function status(): JsonResponse
    {
        $at = trim((string) SystemSetting::getValue('shared_hub_desktop_imported_at', ''));
        return response()->json([
            'imported' => $at !== '',
            'imported_at' => $at !== '' ? $at : null,
        ]);
    }

    public function sync(
        Request $request,
        DesktopInspirationImportService $importer,
        InspirationHubClient $inspirations,
        CreativeTemplateHubClient $templates,
        AgentHubClient $agents
    ): JsonResponse {
        $force = $request->boolean('force');
        $already = trim((string) SystemSetting::getValue('shared_hub_desktop_imported_at', ''));
        if ($already !== '' && !$force) {
            return response()->json([
                'error' => 'already_imported',
                'message' => '本地客户端只做第一次同步，已经灌过。',
                'imported_at' => $already,
            ], 409);
        }

        $file = DesktopInspirationImportService::defaultFile();
        $import = $importer->import($file);
        $hub = SharedHubSyncService::fromClients($inspirations, $templates, $agents)->syncInspirations(500);
        $at = now()->toIso8601String();
        SystemSetting::setValue('shared_hub_desktop_imported_at', $at);

        return response()->json([
            'ok' => true,
            'imported_at' => $at,
            'import' => $import,
            'hub' => $hub,
        ]);
    }
}
