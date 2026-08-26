<?php

namespace App\Http\Middleware;

use App\Services\CloudBuild\CloudBuildExecutionSettings;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class VerifyCloudBuildMirrorWorker
{
    public function __construct(private CloudBuildExecutionSettings $settings)
    {
    }

    public function handle(Request $request, Closure $next): Response
    {
        $result = \App\Services\CloudBuild\CloudBuildMirrorAuth::check(
            (string) $request->header('Authorization', ''),
            $this->settings->workerToken
        );
        if (!$result['ok']) {
            $body = ['error' => $result['error']];
            if ($result['reason']) {
                $body['reason'] = $result['reason'];
            }
            if ($result['error'] === 'mirror_worker_not_configured') {
                $body['hint'] = 'set CLOUDBUILD_MIRROR_WORKER_TOKEN';
            }
            return response()->json($body, $result['status']);
        }

        return $next($request);
    }
}
