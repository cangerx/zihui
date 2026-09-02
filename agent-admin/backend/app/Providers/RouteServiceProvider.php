<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Support\Providers\RouteServiceProvider as ServiceProvider;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;
use App\Support\AppV1Response;

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

        RateLimiter::for('app-auth-login', function (Request $request) {
            $identifier = strtolower(trim((string) ($request->input('identifier')
                ?: $request->input('username')
                ?: $request->input('email'))));

            return Limit::perMinute(10)
                ->by(hash('sha256', (string) $request->ip().'|'.$identifier))
                ->response(fn (Request $request, array $headers) => $this->rateLimited($headers));
        });

        RateLimiter::for('app-auth-register', function (Request $request) {
            return Limit::perMinute(5)
                ->by('ip:' . (string) $request->ip())
                ->response(fn (Request $request, array $headers) => $this->rateLimited($headers));
        });

        RateLimiter::for('app-assets-presign', function (Request $request) {
            return Limit::perMinute(30)
                ->by('ip:' . (string) $request->ip())
                ->response(fn (Request $request, array $headers) => $this->rateLimited($headers));
        });

        RateLimiter::for('app-assets-write', function (Request $request) {
            $subject = $request->user()
                ? 'user:' . $request->user()->getAuthIdentifier()
                : 'ip:' . (string) $request->ip();

            return Limit::perMinute(60)
                ->by($subject)
                ->response(fn (Request $request, array $headers) => $this->rateLimited($headers));
        });

        RateLimiter::for('app-assets-read', function (Request $request) {
            $subject = $request->user()
                ? 'user:' . $request->user()->getAuthIdentifier()
                : 'ip:' . (string) $request->ip();

            return Limit::perMinute(120)
                ->by($subject)
                ->response(fn (Request $request, array $headers) => $this->rateLimited($headers));
        });
    }

    private function rateLimited(array $headers)
    {
        $response = AppV1Response::error('rate_limited', '请求过于频繁，请稍后重试', 429);
        $response->headers->add($headers);

        return $response;
    }
}
