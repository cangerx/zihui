<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Support\Providers\RouteServiceProvider as ServiceProvider;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;

class RouteServiceProvider extends ServiceProvider
{
    public const HOME = '/';

    public function boot()
    {
        $this->configureRateLimiting();

        $this->routes(function () {
            Route::middleware('api')
                ->prefix('api')
                ->group(base_path('routes/api.php'));

            Route::middleware('api')
                ->prefix('api/app/v1')
                ->group(base_path('routes/app.php'));

            Route::middleware('web')
                ->group(base_path('routes/web.php'));
        });
    }

    protected function configureRateLimiting()
    {
        RateLimiter::for('api', function (Request $request) {
            // throttle 在 auth.jwt 之前，$request->user() 恒为空，原先按 IP
            // 把后台、桌面客户端、公开接口打进同一个 120/分钟桶。
            // nginx 下 path 可能是 api/admin/... 或 admin/...，两种都要放行。
            $path = $request->path();
            if (str_starts_with($path, 'admin/') || str_starts_with($path, 'api/admin/')) {
                return Limit::none();
            }
            if ($request->bearerToken()) {
                return Limit::none();
            }
            return Limit::perMinute(180)->by((string) $request->ip());
        });
    }
}
