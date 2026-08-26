<?php

namespace App\Http\Controllers\CloudBuild;

use App\Http\Controllers\Controller;
use App\Services\CloudBuild\CloudBuildMirrorWorkerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CloudBuildMirrorWorkerController extends Controller
{
    public function pending(CloudBuildMirrorWorkerService $service): JsonResponse
    {
        $result = $service->pending();
        return response()->json($result['body'], $result['status']);
    }

    public function ack(Request $request, string $buildId, CloudBuildMirrorWorkerService $service): JsonResponse
    {
        $result = $service->ack($buildId, $request->all());
        return response()->json($result['body'], $result['status']);
    }

    public function fail(Request $request, string $buildId, CloudBuildMirrorWorkerService $service): JsonResponse
    {
        $result = $service->fail($buildId, $request->all());
        return response()->json($result['body'], $result['status']);
    }

    public function purgeable(CloudBuildMirrorWorkerService $service): JsonResponse
    {
        $result = $service->purgeable();
        return response()->json($result['body'], $result['status']);
    }

    public function purgeAck(string $buildId, CloudBuildMirrorWorkerService $service): JsonResponse
    {
        $result = $service->purgeAck($buildId);
        return response()->json($result['body'], $result['status']);
    }
}
