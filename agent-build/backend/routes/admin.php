<?php

use App\Http\Controllers\Admin\AdminAuthController;
use App\Http\Controllers\Admin\AgentHubSettingsController;
use App\Http\Controllers\Admin\AlertSettingController;
use App\Http\Controllers\Admin\AuthRequestAdminController;
use App\Http\Controllers\Admin\BuildAdminRequestController;
use App\Http\Controllers\Admin\BuildClientController;
use App\Http\Controllers\Admin\BuildMaintenanceController;
use App\Http\Controllers\Admin\CreativeTemplateHubSettingsController;
use App\Http\Controllers\Admin\DashboardController;
use App\Http\Controllers\Admin\InspirationHubSettingsController;
use App\Http\Controllers\Admin\QueueAdminController;
use App\Http\Controllers\Admin\PackagingLicenseOrderController;
use App\Http\Controllers\Admin\PackagingLicenseSettingController;
use App\Http\Controllers\Admin\WeChatPaySettingController;
use App\Http\Controllers\Admin\SelfServeOrderController;
use App\Http\Controllers\Admin\OpenSourceOrderController;
use App\Http\Controllers\Admin\SharedAgentCategoryController;
use App\Http\Controllers\Admin\SharedAgentController;
use App\Http\Controllers\Admin\SharedAgentReportController;
use App\Http\Controllers\Admin\SharedCreativeTemplateCategoryController;
use App\Http\Controllers\Admin\SharedCreativeTemplateController;
use App\Http\Controllers\Admin\SharedCreativeTemplateReportController;
use App\Http\Controllers\Admin\SharedInspirationCategoryController;
use App\Http\Controllers\Admin\SharedInspirationController;
use App\Http\Controllers\Admin\SharedInspirationReportController;
use App\Http\Controllers\Admin\TemplateVersionController;
use App\Http\Controllers\Admin\SiteUpdateReleaseController;
use App\Http\Controllers\Admin\SkillRegistryController;
use App\Http\Controllers\UpdateController;
use Illuminate\Support\Facades\Route;

/*
| Admin API Routes (mounted at /admin/api by RouteServiceProvider)
| All except auth/login require auth:sanctum middleware (Bearer token from AdminUser).
*/

Route::prefix('auth')->group(function () {
    Route::post('login', [AdminAuthController::class, 'login']);
    Route::middleware('auth:sanctum')->group(function () {
        Route::get('me', [AdminAuthController::class, 'me']);
        Route::post('logout', [AdminAuthController::class, 'logout']);
    });
});

Route::middleware('auth:sanctum')->group(function () {
    // 授权云控端管理 (CRUD authorized_clients)
    Route::get('clients', [BuildClientController::class, 'index']);
    Route::post('clients', [BuildClientController::class, 'store']);
    Route::get('clients/{clientId}', [BuildClientController::class, 'show']);
    Route::patch('clients/{clientId}', [BuildClientController::class, 'update']);
    Route::delete('clients/{clientId}', [BuildClientController::class, 'destroy']);
    Route::post('clients/batch-import', [BuildClientController::class, 'batchImport']);
    Route::post('clients/batch-delete', [BuildClientController::class, 'batchDelete']);
    Route::post('clients/batch-update-status', [BuildClientController::class, 'batchUpdateStatus']);
    // 共享库审核员任命
    Route::post('clients/{clientId}/set-reviewer', [BuildClientController::class, 'setReviewer']);
    Route::post('clients/batch-set-reviewer', [BuildClientController::class, 'batchSetReviewer']);
    // 「店铺商品图」功能授权：决定某云控端是否开放该功能（云控端再做 per-user 二级门控）
    // 旧（单一 ewei，向后兼容保留）：set-ewei-shop / batch-set-ewei-shop（内部同步 upsert 关联表 'ewei'）
    Route::post('clients/{clientId}/set-ewei-shop', [BuildClientController::class, 'setEweiShop']);
    Route::post('clients/batch-set-ewei-shop', [BuildClientController::class, 'batchSetEweiShop']);
    // 新（按商城泛化）：mall_key 严格 in:ewei,dianda；ewei 同步回写旧列 can_use_ewei_shop
    Route::post('clients/{clientId}/set-mall-auth', [BuildClientController::class, 'setMallAuth']);
    Route::post('clients/batch-set-mall-auth', [BuildClientController::class, 'batchSetMallAuth']);
    Route::post('clients/{clientId}/set-packaging-auth', [BuildClientController::class, 'setPackagingAuth']);
    Route::post('clients/batch-set-packaging-auth', [BuildClientController::class, 'batchSetPackagingAuth']);

    Route::middleware('build_packaging')->group(function () {
        Route::post('clients/batch-reset-quota', [BuildClientController::class, 'batchResetQuota']);
        Route::post('clients/batch-update-limit', [BuildClientController::class, 'batchUpdateLimit']);
        Route::post('clients/{clientId}/set-maintenance-exempt', [BuildClientController::class, 'setMaintenanceExempt']);
        Route::post('clients/batch-set-maintenance-exempt', [BuildClientController::class, 'batchSetMaintenanceExempt']);

        Route::get('requests', [BuildAdminRequestController::class, 'index']);
        Route::get('requests/{buildId}', [BuildAdminRequestController::class, 'show']);
        Route::post('requests/{buildId}/force-cancel', [BuildAdminRequestController::class, 'forceCancel']);
        Route::post('requests/{buildId}/retry', [BuildAdminRequestController::class, 'retry']);
        Route::post('requests/{buildId}/force-purge', [BuildAdminRequestController::class, 'forcePurge']);

        Route::get('queue/status', [QueueAdminController::class, 'status']);
        Route::post('queue/pause', [QueueAdminController::class, 'pause']);
        Route::post('queue/resume', [QueueAdminController::class, 'resume']);

        Route::get('maintenance/build', [BuildMaintenanceController::class, 'show']);
        Route::put('maintenance/build', [BuildMaintenanceController::class, 'update']);

        Route::get('settings/alert', [AlertSettingController::class, 'show']);
        Route::put('settings/alert', [AlertSettingController::class, 'update']);
        Route::post('settings/alert/test', [AlertSettingController::class, 'test']);
    });

    // 授权请求记录（排查「域名已授权却报未授权」：查看客户端实际发来的 Origin / host 与拒因）
    Route::post('auth-requests/clear', [AuthRequestAdminController::class, 'clear']);
    Route::get('auth-requests', [AuthRequestAdminController::class, 'index']);

    Route::get('dashboard/stats', [DashboardController::class, 'stats']);

    Route::get('templates', [TemplateVersionController::class, 'index']);
    Route::get('templates/draft', [TemplateVersionController::class, 'draft']);
    Route::post('templates', [TemplateVersionController::class, 'store']);
    Route::get('templates/{id}', [TemplateVersionController::class, 'show'])->whereNumber('id');
    Route::patch('templates/{id}', [TemplateVersionController::class, 'update'])->whereNumber('id');
    Route::delete('templates/{id}', [TemplateVersionController::class, 'destroy'])->whereNumber('id');
    Route::post('templates/{id}/set-current', [TemplateVersionController::class, 'setCurrent'])->whereNumber('id');

    Route::get('site-update-releases', [SiteUpdateReleaseController::class, 'index']);
    Route::get('site-update-releases/draft', [SiteUpdateReleaseController::class, 'draft']);
    Route::post('site-update-releases', [SiteUpdateReleaseController::class, 'store']);
    Route::patch('site-update-releases/{id}', [SiteUpdateReleaseController::class, 'update'])->whereNumber('id');
    Route::post('site-update-releases/{id}/set-current', [SiteUpdateReleaseController::class, 'setCurrent'])->whereNumber('id');
    Route::delete('site-update-releases/{id}', [SiteUpdateReleaseController::class, 'destroy'])->whereNumber('id');

    // 微信收款配置（自助付费开通商城授权的收款商户，存 system_settings group=wechat_pay）
    Route::get('settings/wechat-pay', [WeChatPaySettingController::class, 'show']);
    Route::put('settings/wechat-pay', [WeChatPaySettingController::class, 'update']);
    Route::post('settings/wechat-pay/test', [WeChatPaySettingController::class, 'test']);
    Route::get('settings/packaging-license', [PackagingLicenseSettingController::class, 'show']);
    Route::put('settings/packaging-license', [PackagingLicenseSettingController::class, 'update']);
    Route::get('packaging-license-orders', [PackagingLicenseOrderController::class, 'index']);
    Route::get('packaging-license-orders/{id}', [PackagingLicenseOrderController::class, 'show'])->whereNumber('id');
    Route::post('packaging-license-orders/{id}/sync', [PackagingLicenseOrderController::class, 'sync'])->whereNumber('id');
    Route::post('packaging-license-orders/{id}/close', [PackagingLicenseOrderController::class, 'close'])->whereNumber('id');

    // 自助付费订单管理（列表 / 详情 / 主动查单同步 / 关单）
    Route::get('self-serve-orders', [SelfServeOrderController::class, 'index']);
    Route::get('self-serve-orders/{id}', [SelfServeOrderController::class, 'show'])->whereNumber('id');
    Route::post('self-serve-orders/{id}/sync', [SelfServeOrderController::class, 'sync'])->whereNumber('id');
    Route::post('self-serve-orders/{id}/close', [SelfServeOrderController::class, 'close'])->whereNumber('id');

    // 开源交付订单管理（列表 / 详情 / 主动查单同步 / 关单 / 标记交付）
    Route::get('open-source-orders', [OpenSourceOrderController::class, 'index']);
    Route::get('open-source-orders/{id}', [OpenSourceOrderController::class, 'show'])->whereNumber('id');
    Route::post('open-source-orders/{id}/sync', [OpenSourceOrderController::class, 'sync'])->whereNumber('id');
    Route::post('open-source-orders/{id}/close', [OpenSourceOrderController::class, 'close'])->whereNumber('id');
    Route::post('open-source-orders/{id}/deliver', [OpenSourceOrderController::class, 'deliver'])->whereNumber('id');

    /*
    |----------------------------------------------------------------------
    | 共享灵感库 v1（平台后台管理）
    |----------------------------------------------------------------------
    | 业务不是云控端调，是平台管理员调用。鉴权走 auth:sanctum。
    */
    // 阈值设置（3 个审核阈值 + 每日提交上限）
    Route::get('inspiration-hub/settings', [InspirationHubSettingsController::class, 'show']);
    Route::put('inspiration-hub/settings', [InspirationHubSettingsController::class, 'update']);

    // 分类 CRUD
    Route::get('shared-inspiration-categories', [SharedInspirationCategoryController::class, 'index']);
    Route::post('shared-inspiration-categories', [SharedInspirationCategoryController::class, 'store']);
    Route::patch('shared-inspiration-categories/{id}', [SharedInspirationCategoryController::class, 'update']);
    Route::delete('shared-inspiration-categories/{id}', [SharedInspirationCategoryController::class, 'destroy']);

    // 举报池（字面量路由必须位于 /{id} 之前）
    Route::get('shared-inspiration-reports', [SharedInspirationReportController::class, 'index']);
    Route::post('shared-inspiration-reports/batch-dismiss', [SharedInspirationReportController::class, 'batchDismiss']);
    Route::get('shared-inspiration-reports/{id}', [SharedInspirationReportController::class, 'show'])->whereNumber('id');
    Route::delete('shared-inspiration-reports/{id}', [SharedInspirationReportController::class, 'dismiss'])->whereNumber('id');

    // 灵感池（字面量 stats / batch-delete 先于 /{id}）
    Route::get('shared-inspirations/stats', [SharedInspirationController::class, 'stats']);
    Route::post('shared-inspirations/batch-delete', [SharedInspirationController::class, 'batchDestroy']);
    Route::get('shared-inspirations', [SharedInspirationController::class, 'index']);
    Route::get('shared-inspirations/{id}', [SharedInspirationController::class, 'show'])->whereNumber('id');
    Route::delete('shared-inspirations/{id}', [SharedInspirationController::class, 'destroy'])->whereNumber('id');
    Route::post('shared-inspirations/{id}/force-approve', [SharedInspirationController::class, 'forceApprove'])->whereNumber('id');
    Route::post('shared-inspirations/{id}/force-reject', [SharedInspirationController::class, 'forceReject'])->whereNumber('id');
    Route::put('shared-inspirations/{id}/visibility', [SharedInspirationController::class, 'setVisibility'])->whereNumber('id');

    Route::get('creative-template-hub/settings', [CreativeTemplateHubSettingsController::class, 'show']);
    Route::put('creative-template-hub/settings', [CreativeTemplateHubSettingsController::class, 'update']);

    Route::get('shared-creative-template-categories', [SharedCreativeTemplateCategoryController::class, 'index']);
    Route::post('shared-creative-template-categories', [SharedCreativeTemplateCategoryController::class, 'store']);
    Route::patch('shared-creative-template-categories/{id}', [SharedCreativeTemplateCategoryController::class, 'update']);
    Route::delete('shared-creative-template-categories/{id}', [SharedCreativeTemplateCategoryController::class, 'destroy']);

    Route::get('shared-creative-template-reports', [SharedCreativeTemplateReportController::class, 'index']);
    Route::post('shared-creative-template-reports/batch-dismiss', [SharedCreativeTemplateReportController::class, 'batchDismiss']);
    Route::get('shared-creative-template-reports/{id}', [SharedCreativeTemplateReportController::class, 'show'])->whereNumber('id');
    Route::delete('shared-creative-template-reports/{id}', [SharedCreativeTemplateReportController::class, 'dismiss'])->whereNumber('id');

    Route::get('shared-creative-templates/stats', [SharedCreativeTemplateController::class, 'stats']);
    Route::post('shared-creative-templates/batch-delete', [SharedCreativeTemplateController::class, 'batchDestroy']);
    Route::get('shared-creative-templates', [SharedCreativeTemplateController::class, 'index']);
    Route::get('shared-creative-templates/{id}', [SharedCreativeTemplateController::class, 'show'])->whereNumber('id');
    Route::delete('shared-creative-templates/{id}', [SharedCreativeTemplateController::class, 'destroy'])->whereNumber('id');
    Route::post('shared-creative-templates/{id}/force-approve', [SharedCreativeTemplateController::class, 'forceApprove'])->whereNumber('id');
    Route::post('shared-creative-templates/{id}/force-reject', [SharedCreativeTemplateController::class, 'forceReject'])->whereNumber('id');
    Route::put('shared-creative-templates/{id}/visibility', [SharedCreativeTemplateController::class, 'setVisibility'])->whereNumber('id');

    /*
    |----------------------------------------------------------------------
    | 智能体共享库 v1（平台后台管理）
    |----------------------------------------------------------------------
    | 镜像 shared-creative-template 后台管理，鉴权同样走 auth:sanctum。
    */
    Route::get('agent-hub/settings', [AgentHubSettingsController::class, 'show']);
    Route::put('agent-hub/settings', [AgentHubSettingsController::class, 'update']);

    Route::get('shared-agent-categories', [SharedAgentCategoryController::class, 'index']);
    Route::post('shared-agent-categories', [SharedAgentCategoryController::class, 'store']);
    Route::patch('shared-agent-categories/{id}', [SharedAgentCategoryController::class, 'update']);
    Route::delete('shared-agent-categories/{id}', [SharedAgentCategoryController::class, 'destroy']);

    Route::get('shared-agent-reports', [SharedAgentReportController::class, 'index']);
    Route::post('shared-agent-reports/batch-dismiss', [SharedAgentReportController::class, 'batchDismiss']);
    Route::get('shared-agent-reports/{id}', [SharedAgentReportController::class, 'show'])->whereNumber('id');
    Route::delete('shared-agent-reports/{id}', [SharedAgentReportController::class, 'dismiss'])->whereNumber('id');

    Route::get('shared-agents/stats', [SharedAgentController::class, 'stats']);
    Route::post('shared-agents/batch-delete', [SharedAgentController::class, 'batchDestroy']);
    Route::get('shared-agents', [SharedAgentController::class, 'index']);
    Route::get('shared-agents/{id}', [SharedAgentController::class, 'show'])->whereNumber('id');
    Route::delete('shared-agents/{id}', [SharedAgentController::class, 'destroy'])->whereNumber('id');
    Route::post('shared-agents/{id}/force-approve', [SharedAgentController::class, 'forceApprove'])->whereNumber('id');
    Route::post('shared-agents/{id}/force-reject', [SharedAgentController::class, 'forceReject'])->whereNumber('id');
    Route::put('shared-agents/{id}/visibility', [SharedAgentController::class, 'setVisibility'])->whereNumber('id');

    // 0.5.0：腾讯云 COS 配置已下线（随家庭电脑中转方案上线同步退役）。
    // 原 3 个 settings/cos 路由 + SystemSettingsController 不再注册；CosService.php / Settings.tsx 上古控件作为历史资源保留（git log）。

    Route::get('skill-registry', [SkillRegistryController::class, 'index']);
    Route::get('skill-registry/pending', [SkillRegistryController::class, 'pending']);
    Route::get('skill-registry/reports', [SkillRegistryController::class, 'reports']);
    Route::post('skill-registry/upload', [SkillRegistryController::class, 'upload']);
    Route::get('skill-registry/{skillId}', [SkillRegistryController::class, 'show']);
    Route::post('skill-registry/{skillId}/reports', [SkillRegistryController::class, 'report']);
    Route::post('skill-registry/versions/{versionId}/review', [SkillRegistryController::class, 'review']);
    Route::post('skill-registry/versions/{versionId}/revoke', [SkillRegistryController::class, 'revoke']);

    // 在线更新（throttle 放宽：升级中前端 1.5s 轮询 progress，多次重试不应被默认 60/min 限流）
    Route::prefix('updates')->middleware('throttle:600,1')->group(function () {
        Route::get('/current', [UpdateController::class, 'current']);
        Route::get('/check', [UpdateController::class, 'check']);
        Route::post('/apply', [UpdateController::class, 'apply']);
        Route::get('/progress', [UpdateController::class, 'progress']);
        Route::get('/history', [UpdateController::class, 'history']);
        Route::get('/db-check', [UpdateController::class, 'dbCheck']);
        Route::post('/db-repair', [UpdateController::class, 'dbRepair']);
        Route::get('/releases', [UpdateController::class, 'releases']);
    });
});
