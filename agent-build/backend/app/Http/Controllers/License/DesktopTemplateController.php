<?php

namespace App\Http\Controllers\License;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class DesktopTemplateController extends Controller
{
    /** GET /api/license/desktop-template — 不走已下线的 /api/build/* */
    public function show(): JsonResponse
    {
        $current = DB::table('template_versions')->where('is_current', 1)->first();

        return response()->json([
            'current_version' => $current->version ?? null,
            'released_at' => $current->released_at ?? null,
            'changelog' => $current->changelog ?? null,
        ], 200);
    }
}
