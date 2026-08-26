<?php

use App\Http\Controllers\App\V1\BillingController;
use App\Http\Controllers\App\V1\BootstrapController;
use App\Http\Controllers\App\V1\AuthController;
use App\Http\Controllers\App\V1\ModelController;
use Illuminate\Support\Facades\Route;

Route::middleware('app.request')->group(function () {
    Route::get('/bootstrap', BootstrapController::class)->middleware('auth.jwt.optional');

    Route::prefix('auth')->group(function () {
        Route::post('/password/login', [AuthController::class, 'login']);
        Route::post('/password/register', [AuthController::class, 'register']);
        Route::post('/refresh', [AuthController::class, 'refresh']);
        Route::middleware('auth.jwt')->group(function () {
            Route::get('/me', [AuthController::class, 'me']);
            Route::post('/logout', [AuthController::class, 'logout']);
        });
    });

    Route::get('/billing/plans', [BillingController::class, 'plans']);

    Route::middleware('auth.jwt')->group(function () {
        Route::get('/models', [ModelController::class, 'index']);
        Route::get('/billing/balance', [BillingController::class, 'balance']);
    });
});
