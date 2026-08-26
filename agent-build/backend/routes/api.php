<?php

use App\Http\Controllers\Build\BuildRequestController;
use App\Http\Controllers\Build\BuildCallbackController;
use App\Http\Controllers\Build\BuildTemplateController;
use App\Http\Controllers\Build\MirrorWorkerController;
use App\Http\Controllers\Hub\AgentHubController;
use App\Http\Controllers\Hub\CreativeTemplateHubController;
use App\Http\Controllers\Hub\InspirationHubController;
use App\Http\Controllers\License\DesktopTemplateController;
use App\Http\Controllers\License\SiteLicenseController;
use App\Http\Controllers\SiteUpdateFeedController;
use App\Http\Controllers\SelfServe\MallPurchaseController;
use App\Http\Controllers\SelfServe\PackagingPurchaseController;
use App\Http\Controllers\OpenSource\OpenSourceDeliveryController;
use App\Http\Controllers\SkillRegistryPublicController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API Routes  (RouteServiceProvider 自动加 /api 前缀)
|--------------------------------------------------------------------------
*/

Route::prefix('build')->middleware('build_packaging')->group(function () {
    // 云控端调用，仅域名校验（0.2.0 起取消 HMAC 签名机制）
    Route::middleware(['domain_binding'])->group(function () {
        Route::get('auth-check', [BuildRequestController::class, 'authCheck']);
        // 域名方自查 / 自改姓名电话（domain 由中间件按 Origin 认证后注入，不接受前端传入）
        Route::get('my-info', [BuildRequestController::class, 'myInfo']);
        Route::put('my-info', [BuildRequestController::class, 'updateMyInfo']);
        Route::post('request', [BuildRequestController::class, 'request']);
        Route::get('status/{buildId}', [BuildRequestController::class, 'status']);
        Route::post('cancel/{buildId}', [BuildRequestController::class, 'cancel']);
        Route::get('download/{buildId}', [BuildRequestController::class, 'download']);
        Route::post('ack/{buildId}', [BuildRequestController::class, 'ack']);
        Route::get('list', [BuildRequestController::class, 'list']);
        Route::get('template-info', [BuildTemplateController::class, 'info']);
    });

    // GitHub Actions workflow 末尾回调，Bearer callback_token 校验
    Route::post('callback', [BuildCallbackController::class, 'callback']);

    // 0.5.0 家庭电脑 mirror worker API。Bearer worker_token 校验（system_settings.mirror.worker_token）
    // worker_token 由 `php artisan mirror:rotate-worker-token` 生成，运维 SSH 上服务器跑一次拷贝输出。
    Route::middleware(['mirror_worker'])->prefix('mirror')->group(function () {
        Route::get('pending', [MirrorWorkerController::class, 'pending']);
        Route::post('{buildId}/ack', [MirrorWorkerController::class, 'ack']);
        Route::post('{buildId}/fail', [MirrorWorkerController::class, 'fail']);
        Route::get('purgeable', [MirrorWorkerController::class, 'purgeable']);
        Route::post('{buildId}/purge-ack', [MirrorWorkerController::class, 'purgeAck']);
    });
});

/*
|--------------------------------------------------------------------------
| 自助付费开通商城授权（公开，免登录）
|--------------------------------------------------------------------------
| 独立自助页：输入域名 → 查三商城授权态 → 勾选未授权项微信扫码付款 → 自动开通。
| 无 domain_binding（访问者 Origin 是授权管理端自身，不是被查询域名），按 throttle 限流。
| notify 为微信支付回调，靠平台签名校验，单独放宽限流（微信会重试）。
*/
Route::middleware(['domain_binding', 'throttle:60,1'])->get('license/site', [SiteLicenseController::class, 'show']);
Route::middleware('throttle:60,1')->get('license/desktop-template', [DesktopTemplateController::class, 'show']);

Route::middleware('throttle:120,1')->prefix('updates/{channel}')->group(function () {
    Route::get('version.json', [SiteUpdateFeedController::class, 'version']);
    Route::get('releases.json', [SiteUpdateFeedController::class, 'releases']);
    Route::get('packages/{version}', [SiteUpdateFeedController::class, 'package'])->where('version', '.*');
});

Route::prefix('self-serve/packaging')->group(function () {
    Route::middleware('throttle:60,1')->group(function () {
        Route::get('query', [PackagingPurchaseController::class, 'query']);
        Route::post('order', [PackagingPurchaseController::class, 'createOrder']);
        Route::get('order/{orderNo}', [PackagingPurchaseController::class, 'showOrder']);
    });
    Route::middleware('throttle:200,1')->post('notify', [PackagingPurchaseController::class, 'notify']);
});

Route::prefix('self-serve/mall-auth')->group(function () {
    Route::middleware('throttle:60,1')->group(function () {
        Route::get('query', [MallPurchaseController::class, 'query']);
        Route::post('order', [MallPurchaseController::class, 'createOrder']);
        Route::get('order/{orderNo}', [MallPurchaseController::class, 'showOrder']);
    });
    Route::middleware('throttle:200,1')->post('notify', [MallPurchaseController::class, 'notify']);
});

/*
|--------------------------------------------------------------------------
| 开源交付（公开，免登录）
|--------------------------------------------------------------------------
| 独立公开页：选择先锋开源档 → 填购买人信息 → 微信扫码付款 → 回调标记已支付（人工交付）。
| 无 domain_binding（访问者 Origin 是授权管理端自身），按 throttle 限流。
| notify 为微信支付回调，靠平台签名校验，单独放宽限流（微信会重试）。
*/
Route::prefix('open-source')->group(function () {
    Route::middleware('throttle:60,1')->group(function () {
        Route::get('config', [OpenSourceDeliveryController::class, 'config']);
        Route::post('order', [OpenSourceDeliveryController::class, 'createOrder']);
        Route::get('order/{orderNo}', [OpenSourceDeliveryController::class, 'showOrder']);
    });
    Route::middleware('throttle:200,1')->post('notify', [OpenSourceDeliveryController::class, 'notify']);
});

/*
|--------------------------------------------------------------------------
| 共享灵感库 v1（云控端调用）
|--------------------------------------------------------------------------
| domain_binding 中间件按 Origin 校验 authorized_clients.domain，注入 client。
| 审核员专属端点叠加 hub_reviewer 中间件（要求 is_hub_reviewer=1）。
|
| 限流：分享 / 投票 / 举报全部走 throttle:60,1，避免恶意刷量。
*/
Route::prefix('inspiration-hub')->middleware(['domain_binding', 'throttle:60,1'])->group(function () {
    // 公开层（任意已授权云控端）
    Route::get('me', [InspirationHubController::class, 'me']);
    Route::get('categories', [InspirationHubController::class, 'categories']);
    Route::get('list', [InspirationHubController::class, 'list']);
    Route::post('status-batch', [InspirationHubController::class, 'statusBatch']);
    Route::post('submit', [InspirationHubController::class, 'submit']);
    // by-source 必须先于 /{id} 字面量优先
    Route::delete('by-source/{localId}', [InspirationHubController::class, 'withdrawBySource'])
        ->whereNumber('localId');

    // 审核员层（is_hub_reviewer=1）
    Route::middleware('hub_reviewer')->group(function () {
        Route::get('pending-list', [InspirationHubController::class, 'pendingList']);
        Route::post('{id}/review', [InspirationHubController::class, 'review'])->whereNumber('id');
    });

    // /{id} 系列（必须放在所有字面量路由之后）
    Route::get('{id}', [InspirationHubController::class, 'show'])->whereNumber('id');
    Route::post('{id}/download', [InspirationHubController::class, 'download'])->whereNumber('id');
    Route::post('{id}/report', [InspirationHubController::class, 'report'])->whereNumber('id');
});

Route::prefix('creative-template-hub')->middleware(['domain_binding', 'throttle:60,1'])->group(function () {
    Route::get('me', [CreativeTemplateHubController::class, 'me']);
    Route::get('categories', [CreativeTemplateHubController::class, 'categories']);
    Route::get('list', [CreativeTemplateHubController::class, 'list']);
    Route::post('status-batch', [CreativeTemplateHubController::class, 'statusBatch']);
    Route::post('submit', [CreativeTemplateHubController::class, 'submit']);
    Route::delete('by-source/{localId}', [CreativeTemplateHubController::class, 'withdrawBySource'])
        ->whereNumber('localId');

    Route::middleware('hub_reviewer')->group(function () {
        Route::get('pending-list', [CreativeTemplateHubController::class, 'pendingList']);
        Route::post('{id}/review', [CreativeTemplateHubController::class, 'review'])->whereNumber('id');
    });

    Route::get('{id}', [CreativeTemplateHubController::class, 'show'])->whereNumber('id');
    Route::post('{id}/download', [CreativeTemplateHubController::class, 'download'])->whereNumber('id');
    Route::post('{id}/report', [CreativeTemplateHubController::class, 'report'])->whereNumber('id');
});

/*
|--------------------------------------------------------------------------
| 智能体共享库 v1（云控端调用）
|--------------------------------------------------------------------------
| 镜像 creative-template-hub：domain_binding 中间件按 Origin 校验后注入 client，
| 审核员专属端点叠加 hub_reviewer 中间件。限流统一 throttle:60,1。
|
| 注意：智能体 source_local_id 为字符串，by-source/{localId} 不加 whereNumber。
*/
Route::prefix('agent-hub')->middleware(['domain_binding', 'throttle:60,1'])->group(function () {
    Route::get('me', [AgentHubController::class, 'me']);
    Route::get('categories', [AgentHubController::class, 'categories']);
    Route::get('list', [AgentHubController::class, 'list']);
    Route::post('status-batch', [AgentHubController::class, 'statusBatch']);
    Route::post('submit', [AgentHubController::class, 'submit']);
    Route::delete('by-source/{localId}', [AgentHubController::class, 'withdrawBySource']);

    Route::middleware('hub_reviewer')->group(function () {
        Route::get('pending-list', [AgentHubController::class, 'pendingList']);
        Route::post('{id}/review', [AgentHubController::class, 'review'])->whereNumber('id');
    });

    Route::get('{id}', [AgentHubController::class, 'show'])->whereNumber('id');
    Route::post('{id}/download', [AgentHubController::class, 'download'])->whereNumber('id');
    Route::post('{id}/report', [AgentHubController::class, 'report'])->whereNumber('id');
});

Route::prefix('skills/v1')->middleware('throttle:60,1')->group(function () {
    Route::middleware('skill_registry_sync')->group(function () {
        Route::get('events', [SkillRegistryPublicController::class, 'events']);
        Route::post('versions/{versionId}/download-ticket', [SkillRegistryPublicController::class, 'downloadTicket']);
    });
    Route::get('download/{token}', [SkillRegistryPublicController::class, 'download']);
});
