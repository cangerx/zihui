<?php

namespace App\Http\Controllers\CloudBuild;

use App\Http\Controllers\Controller;
use App\Services\CloudBuild\CloudBuildCallbackService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GitHub Actions 构建结束回调。Bearer 为任务级 callback_token，不是站点 JWT。
 * 与 POST /api/build/wake 无关：wake 仍只唤醒授权端投影拉取。
 */
class CloudBuildCallbackController extends Controller
{
    public function callback(Request $request, CloudBuildCallbackService $service): JsonResponse
    {
        $auth = (string) $request->header('Authorization', '');
        $token = str_starts_with($auth, 'Bearer ') ? substr($auth, 7) : '';
        $result = $service->handle($token, $request->all());

        return response()->json($result['body'], $result['status']);
    }
}
