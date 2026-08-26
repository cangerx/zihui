<?php

namespace App\Exceptions;

use Illuminate\Foundation\Exceptions\Handler as ExceptionHandler;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Throwable;

class Handler extends ExceptionHandler
{
    /**
     * A list of exception types with their corresponding custom log levels.
     *
     * @var array<class-string<\Throwable>, \Psr\Log\LogLevel::*>
     */
    protected $levels = [
        //
    ];

    /**
     * A list of the exception types that are not reported.
     *
     * @var array<int, class-string<\Throwable>>
     */
    protected $dontReport = [
        //
    ];

    /**
     * A list of the inputs that are never flashed to the session on validation exceptions.
     *
     * @var array<int, string>
     */
    protected $dontFlash = [
        'current_password',
        'password',
        'password_confirmation',
    ];

    /**
     * Register the exception handling callbacks for the application.
     *
     * @return void
     */
    public function register()
    {
        $this->reportable(function (Throwable $e) {
            //
        });

        // 限流 429 标准化：Laravel 默认渲染 {message: "Too Many Attempts."} 没有 error 字段，
        // 老版本云控端解析不出原因只能显示「agent-build 拒绝：unknown」。
        // 统一补 error 错误码 + 中文提示，让所有版本云控端都能翻译出人话。
        $this->renderable(function (ThrottleRequestsException $e, $request) {
            if (!$request->is('api/*') && !$request->expectsJson()) {
                return null;
            }
            $retryAfter = (int) ($e->getHeaders()['Retry-After'] ?? 60);
            return response()->json([
                'error' => 'rate_limited',
                'message' => "请求过于频繁，请 {$retryAfter} 秒后重试",
                'retry_after' => $retryAfter,
            ], 429, $e->getHeaders());
        });
    }
}
