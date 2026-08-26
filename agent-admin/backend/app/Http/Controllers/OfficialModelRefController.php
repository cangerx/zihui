<?php

namespace App\Http\Controllers;

use App\Services\ModelRef\OfficialModelRefService;
use Illuminate\Http\Request;
use Throwable;

class OfficialModelRefController extends Controller
{
    public function lookup(Request $request, OfficialModelRefService $service)
    {
        $modelId = trim((string) $request->query('model_id', ''));
        if ($modelId === '') {
            return response()->json(['error' => 'model_id 不能为空'], 422);
        }

        $modality = $request->query('modality');
        $modality = is_string($modality) && $modality !== '' ? $modality : null;

        try {
            return response()->json($service->lookup($modelId, $modality));
        } catch (Throwable $e) {
            return response()->json([
                'found' => false,
                'id' => null,
                'modality' => $modality,
                'unit' => null,
                'amount_cny' => null,
                'text' => '',
                'source_url' => '',
                'captured_at' => '',
            ]);
        }
    }
}
