<?php

namespace App\Http;

use Illuminate\Foundation\Http\Kernel as HttpKernel;

class Kernel extends HttpKernel
{
    protected $middleware = [
        \Illuminate\Http\Middleware\HandleCors::class,
        \Illuminate\Foundation\Http\Middleware\ValidatePostSize::class,
        \Illuminate\Foundation\Http\Middleware\TrimStrings::class,
        \Illuminate\Foundation\Http\Middleware\ConvertEmptyStringsToNull::class,
    ];

    protected $middlewareGroups = [
        'web' => [
            \Illuminate\Cookie\Middleware\EncryptCookies::class,
            \Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse::class,
            \Illuminate\Session\Middleware\StartSession::class,
            \Illuminate\View\Middleware\ShareErrorsFromSession::class,
            \Illuminate\Routing\Middleware\SubstituteBindings::class,
        ],

        'api' => [
            // 全局限流按 IP 计数，后台概览一次并发二十多个请求就会 429，
            // 页面表现为所有菜单「加载失败」。敏感接口仍走路由级 throttle。
            \Illuminate\Routing\Middleware\SubstituteBindings::class,
        ],
    ];

    protected $routeMiddleware = [
        'auth' => \App\Http\Middleware\Authenticate::class,
        'auth.jwt' => \App\Http\Middleware\JwtAuthMiddleware::class,
        'auth.jwt.optional' => \App\Http\Middleware\OptionalJwtAuth::class,
        'admin' => \App\Http\Middleware\AdminOnly::class,
        'throttle' => \App\Http\Middleware\CacheTolerantThrottleRequests::class,
        'mirror_worker' => \App\Http\Middleware\VerifyCloudBuildMirrorWorker::class,
        'app.request' => \App\Http\Middleware\AppRequestContext::class,
    ];
}
