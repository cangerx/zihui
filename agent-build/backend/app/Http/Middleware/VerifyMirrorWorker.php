<?php

namespace App\Http\Middleware;

use App\Services\SystemSetting\SettingService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * 0.5.0：家庭电脑 mirror worker 鉴权。
 *
 * 验证请求头：Authorization: Bearer <token>
 * token 与 system_settings 表 group_key='mirror' setting_key='worker_token'（加密存储）比对。
 *
 * 不引入业务记录注入（mirror worker 是单租户运维角色，不像 VerifyDomainBinding
 * 要把 client 注入下游）；只做通过/拒绝。
 *
 * worker_token 由 artisan mirror:rotate-worker-token 命令生成（运维 SSH 上服务器跑一次，
 * 拷贝输出贴到家庭电脑 .env），不通过任何 admin UI 暴露 —— 减少攻击面，避免登录 admin
 * 后台的人能拿到 worker token 滥用 mirror 接口。
 */
class VerifyMirrorWorker
{
    private SettingService $settings;

    public function __construct(SettingService $settings)
    {
        $this->settings = $settings;
    }

    public function handle(Request $request, Closure $next): Response
    {
        $authHeader = $request->header('Authorization', '');
        if (!is_string($authHeader) || !str_starts_with($authHeader, 'Bearer ')) {
            return response()->json(['error' => 'mirror_worker_unauthorized', 'reason' => 'missing_bearer'], 401);
        }
        $presented = substr($authHeader, 7);

        $expected = (string) $this->settings->get('mirror', 'worker_token', '');
        if ($expected === '') {
            return response()->json([
                'error' => 'mirror_worker_not_configured',
                'hint' => 'run "php artisan mirror:rotate-worker-token" on agent-build server',
            ], 503);
        }

        if (!hash_equals($expected, $presented)) {
            return response()->json(['error' => 'mirror_worker_unauthorized', 'reason' => 'token_mismatch'], 401);
        }

        return $next($request);
    }
}
