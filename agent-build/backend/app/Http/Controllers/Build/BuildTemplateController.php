<?php

namespace App\Http\Controllers\Build;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class BuildTemplateController extends Controller
{
    /**
     * GET /api/build/template-info
     * 返回当前模板版本 + 客户上次打包版本 + has_update 标记。
     */
    public function info(Request $request): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');

        $current = DB::table('template_versions')->where('is_current', 1)->first();

        $lastBuild = DB::table('build_requests')
            ->where('client_id', $client->client_id)
            ->whereIn('status', ['success', 'delivered', 'purged'])
            ->orderByDesc('created_at')
            ->first(['app_version', 'created_at']);

        return response()->json([
            'current_version' => $current ? $current->version : null,
            'released_at' => $current ? $current->released_at : null,
            'changelog' => $current ? $current->changelog : null,
            'client_last_version' => $lastBuild ? $lastBuild->app_version : null,
            'client_last_build_at' => $lastBuild ? $lastBuild->created_at : null,
            'has_update' => $current && $lastBuild
                ? version_compare($current->version, $lastBuild->app_version, '>')
                : ($current !== null && $lastBuild === null),
        ], 200);
    }
}
