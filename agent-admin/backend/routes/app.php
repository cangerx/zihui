<?php

use App\Http\Controllers\App\V1\BillingController;
use App\Http\Controllers\App\V1\BootstrapController;
use App\Http\Controllers\App\V1\AuthController;
use App\Http\Controllers\App\V1\ConversationController;
use App\Http\Controllers\App\V1\ModelController;
use App\Http\Controllers\App\V1\TaskController;
use App\Http\Controllers\App\V1\AssetController;
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

        Route::prefix('conversations')->group(function () {
            Route::get('/', [ConversationController::class, 'index']);
            Route::post('/', [ConversationController::class, 'store']);
            Route::get('/{id}', [ConversationController::class, 'show'])->whereNumber('id');
            Route::match(['put', 'patch'], '/{id}', [ConversationController::class, 'update'])->whereNumber('id');
            Route::delete('/{id}', [ConversationController::class, 'destroy'])->whereNumber('id');
            Route::post('/{id}/messages', [ConversationController::class, 'sendMessage'])->whereNumber('id');
            Route::post('/{id}/stream', [ConversationController::class, 'streamMessage'])->whereNumber('id');
        });

        Route::post('/image-tasks', [TaskController::class, 'createImage'])->middleware('throttle:60,1');
        Route::get('/tasks', [TaskController::class, 'index']);
        Route::post('/tasks/{id}/cancel', [TaskController::class, 'cancel']);
        Route::delete('/tasks/{id}', [TaskController::class, 'destroy']);
        Route::get('/tasks/{id}', [TaskController::class, 'show']);

        Route::prefix('assets')->middleware('throttle:60,1')->group(function () {
            Route::post('/presign', [AssetController::class, 'presign'])->name('app.v1.assets.presign');
            Route::put('/{id}/content', [AssetController::class, 'put'])
                ->name('app.v1.assets.content.put')->middleware('signed');
            Route::post('/{id}/complete', [AssetController::class, 'complete'])->name('app.v1.assets.complete');
            Route::get('/{id}/content', [AssetController::class, 'content'])->name('app.v1.assets.content')->middleware('signed');
        });
    });
});
