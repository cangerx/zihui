<?php

namespace App\Services\CloudBuild;

class CloudBuildMirrorAuth
{
    /**
     * @return array{ok:bool,status:int,error:?string,reason:?string}
     */
    public static function check(string $authorizationHeader, string $expectedToken): array
    {
        if (!str_starts_with($authorizationHeader, 'Bearer ')) {
            return ['ok' => false, 'status' => 401, 'error' => 'mirror_worker_unauthorized', 'reason' => 'missing_bearer'];
        }
        if ($expectedToken === '') {
            return ['ok' => false, 'status' => 503, 'error' => 'mirror_worker_not_configured', 'reason' => null];
        }
        $presented = substr($authorizationHeader, 7);
        if (!hash_equals($expectedToken, $presented)) {
            return ['ok' => false, 'status' => 401, 'error' => 'mirror_worker_unauthorized', 'reason' => 'token_mismatch'];
        }
        return ['ok' => true, 'status' => 200, 'error' => null, 'reason' => null];
    }
}
