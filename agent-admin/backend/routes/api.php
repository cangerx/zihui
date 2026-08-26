<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\UserController;
use App\Http\Controllers\UserGroupController;
use App\Http\Controllers\CloudProviderController;
use App\Http\Controllers\DeckResourceAssetController;
use App\Http\Controllers\TtsProviderController;
use App\Http\Controllers\TtsAudioController;
use App\Http\Controllers\ImageSearchController;
use App\Http\Controllers\ProviderCredentialController;
use App\Http\Controllers\CloudModelController;
use App\Http\Controllers\OfficialModelRefController;
use App\Http\Controllers\ModelAssignmentController;
use App\Http\Controllers\PermissionController;
use App\Http\Controllers\BillingRuleController;
use App\Http\Controllers\BalanceController;
use App\Http\Controllers\UsageRecordController;
use App\Http\Controllers\GatewayController;
use App\Http\Controllers\MattingController;
use App\Http\Controllers\FineMattingController;
use App\Http\Controllers\VideoController;
use App\Http\Controllers\ClientController;
use App\Http\Controllers\SyncController;
use App\Http\Controllers\BlobController;
use App\Http\Controllers\SystemController;
use App\Http\Controllers\SettingController;
use App\Http\Controllers\RedeemController;
use App\Http\Controllers\PlanController;
use App\Http\Controllers\PaymentController;
use App\Http\Controllers\RechargeController;
use App\Http\Controllers\DesktopMenuController;
use App\Http\Controllers\OemChannelController;
use App\Http\Controllers\OemCommissionController;
use App\Http\Controllers\UpdateController;
use App\Http\Controllers\CloudBuild\CloudBuildController;
use App\Http\Controllers\CloudBuild\CloudBuildIconController;
use App\Http\Controllers\CloudBuild\OemProjectController;
use App\Http\Controllers\CloudBuild\CloudBuildWakeController;
use App\Http\Controllers\CloudBuild\CloudBuildCallbackController;
use App\Http\Controllers\SkillCatalog\SkillCatalogAdminController;
use App\Http\Controllers\SkillCatalog\SkillCatalogClientController;
use App\Http\Controllers\HomepageController;
use App\Http\Controllers\HomepagePhrasePackController;
use App\Http\Controllers\InspirationController;
use App\Http\Controllers\InspirationHubController;
use App\Http\Controllers\SharedHubSyncController;
use App\Http\Controllers\CreativeTemplateController;
use App\Http\Controllers\CreativeTemplateHubController;
use App\Http\Controllers\CreativeTemplatePublicController;
use App\Http\Controllers\AnnouncementController;
use App\Http\Controllers\DocController;
use App\Http\Controllers\AgentController;
use App\Http\Controllers\AgentPublicController;
use App\Http\Controllers\AgentHubController;
use App\Http\Controllers\KnowledgeBaseController;
use App\Http\Controllers\StylePresetController;
use App\Http\Controllers\StylePresetPublicController;

// ========== Public ==========
Route::post('/auth/login', [AuthController::class, 'login']);
Route::post('/auth/register', [AuthController::class, 'register']);
Route::post('/auth/refresh', [AuthController::class, 'refresh']);
// 短信验证码发送（注册 / 找回密码共用）：严格限流防刷，单 IP 每分钟最多 5 次
Route::middleware('throttle:5,1')->post('/auth/sms/send', [AuthController::class, 'sendSmsCode']);
// 找回密码：凭手机号 + 验证码重置，单 IP 每分钟最多 10 次
Route::middleware('throttle:10,1')->post('/auth/password/reset', [AuthController::class, 'resetPassword']);

// 微信支付回调（公开端点，靠平台证书验签 + APIv3 解密保证安全，不能加 auth.jwt）
// 单独 throttle：微信重试、多订单同时回调可能高于默认 60/min
Route::middleware('throttle:200,1')->post('/payment/wechat/notify', [PaymentController::class, 'notify']);
// 虎皮椒异步回调（公开端点，MD5 验签，最多重试 6 次，处理成功须回纯文本 success）
Route::middleware('throttle:200,1')->post('/payment/xunhupay/notify', [PaymentController::class, 'xunhupayNotify']);

// 公开站点配置（不需登录，仅暴露白名单字段，桌面端启动 / Web 登录页用）
Route::get('/public/site-config', [SettingController::class, 'publicConfig']);

// 官网页面配置（不需登录，root / 的静态 HTML 首屏拉取）
Route::get('/public/homepage-config', [HomepageController::class, 'publicConfig']);

// 灵感广场公开接口（桌面端拉取，不需登录）
Route::get('/public/inspiration/config', [InspirationController::class, 'publicConfig']);
Route::get('/public/inspiration/list', [InspirationController::class, 'publicList']);
Route::get('/public/inspiration/categories', [InspirationController::class, 'publicCategories']);

// 创意模板公开接口（桌面端「云端模板」tab 拉取，不需登录）
Route::get('/public/creative-templates/categories', [CreativeTemplatePublicController::class, 'categories']);
Route::get('/public/creative-templates/list',       [CreativeTemplatePublicController::class, 'list']);
Route::get('/public/creative-templates/{id}',       [CreativeTemplatePublicController::class, 'show'])->whereNumber('id');

// 风格预设公开接口（桌面端各生图入口拉取，不需登录；数量少一次拉全，不分页）
Route::get('/public/style-presets/categories', [StylePresetPublicController::class, 'categories']);
Route::get('/public/style-presets/list',       [StylePresetPublicController::class, 'list']);

// 智能体市场公开接口（桌面端「智能体市场」tab 拉取）
// list / show 套可选鉴权：带 token 则按用户可见范围过滤并标记是否已拥有，不带则只看公开智能体
Route::get('/public/agents/categories', [AgentPublicController::class, 'categories']);
Route::middleware('auth.jwt.optional')->group(function () {
    Route::get('/public/agents',      [AgentPublicController::class, 'list']);
    Route::get('/public/agents/{id}', [AgentPublicController::class, 'show'])->whereNumber('id');
});
Route::middleware('throttle:60,1')->post('/public/agents/{id}/download', [AgentPublicController::class, 'incrementDownload'])->whereNumber('id');

// 文档站公开端点（受 docs_enabled + docs_guest_access 门控；config 不做门控，前端要拉到才能判断是否跳登录）
// /{idOrSlug} 必须放在所有字面量路由之后，否则会被吞
Route::get('/public/docs/config',     [DocController::class, 'publicConfig']);
Route::get('/public/docs/categories', [DocController::class, 'publicCategories']);
Route::get('/public/docs/list',       [DocController::class, 'publicList']);
// 文档 RAG 流式问答（公开；限流 30/min 防刷）
Route::middleware('throttle:30,1')->post('/public/docs/chat', [DocController::class, 'publicChat']);
Route::get('/public/docs/{idOrSlug}', [DocController::class, 'publicShow']);

// 云打包 wake 信号（公开端点，仅接受 build_id；本端用现有 Origin 域名鉴权回拉数据，
// 因此 wake 端点本身无需鉴权。throttle 防 DoS）
Route::middleware('throttle:120,1')->post('/build/wake', [CloudBuildWakeController::class, 'wake']);

// GitHub Actions 本地执行回调（T4.2）。Bearer 为任务 callback_token，与 /build/wake 无关。
Route::middleware('throttle:60,1')->post('/cloud-build/callback', [CloudBuildCallbackController::class, 'callback']);

Route::middleware('throttle:60,1')->get('/cloud-build/dl/{token}', [\App\Http\Controllers\CloudBuild\CloudBuildArtifactDownloadController::class, 'download'])
    ->where('token', '[A-Za-z0-9_-]+');

Route::middleware(['throttle:60,1', 'mirror_worker'])->prefix('cloud-build/mirror')->group(function () {
    Route::get('/pending', [\App\Http\Controllers\CloudBuild\CloudBuildMirrorWorkerController::class, 'pending']);
    Route::post('/{buildId}/ack', [\App\Http\Controllers\CloudBuild\CloudBuildMirrorWorkerController::class, 'ack']);
    Route::post('/{buildId}/fail', [\App\Http\Controllers\CloudBuild\CloudBuildMirrorWorkerController::class, 'fail']);
    Route::get('/purgeable', [\App\Http\Controllers\CloudBuild\CloudBuildMirrorWorkerController::class, 'purgeable']);
    Route::post('/{buildId}/purge-ack', [\App\Http\Controllers\CloudBuild\CloudBuildMirrorWorkerController::class, 'purgeAck']);
});

// AI 视频/生图 参考素材直出（公开端点，无需登录）：storage_type=local 且 public 目录不可写时，
// 参考素材落 storage 兜底目录、按 public 直链外部访问会 404，上游服务商回拉与桌面端预览失效。
// 本端点经 readBytes 从 public 或 storage 兜底目录回流，保证可拉。key 含不可猜 uuid（同 public 直链
// 安全模型），且只服务参考素材两个子目录、拒绝路径穿越；已受 api 组全局限流(120/min/IP)保护。
Route::get('/public/videos/reference-blob/{path}', [VideoController::class, 'publicServeReferenceBlob'])
    ->where('path', '(video-reference-assets|image-reference-assets)/[A-Za-z0-9._-]+');

// ========== Authenticated (JWT) ==========
Route::middleware('auth.jwt')->group(function () {

    // Auth
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::post('/auth/password', [AuthController::class, 'changePassword']);

    // Client APIs (for Electron app)
    Route::prefix('client')->group(function () {
        // AI Deck 资源 manifest(ffmpeg / 模板 按需下发; 桌面端从其绑定云控端拉)
        Route::get('/deck/resource-manifest', [DeckResourceAssetController::class, 'clientManifest']);
        // 解说 TTS(key 留云控端, 服务端代调上游): 音色目录 + 合成
        Route::get('/audio/catalog', [TtsAudioController::class, 'catalog']);
        Route::post('/audio/synthesize', [TtsAudioController::class, 'synthesize']);
        // 真实素材图搜索(deck 配图三级第一级, 代理 Pixabay; key 在后台「系统设置」配置, 留服务端)
        Route::get('/image-search', [ImageSearchController::class, 'search']);
        Route::get('/models', [ClientController::class, 'myModels']);
        Route::get('/permissions', [ClientController::class, 'myPermissions']);
        Route::get('/balance', [ClientController::class, 'myBalance']);
        Route::get('/quotas', [ClientController::class, 'myQuotas']);
        Route::get('/balance-logs', [ClientController::class, 'myBalanceLogs']);
        Route::get('/usage', [ClientController::class, 'myUsage']);
        Route::get('/billing-rules', [ClientController::class, 'myBillingRules']);

        // 云同步与容量计费（桌面端增量同步 + 媒体 blob + 容量查询）
        Route::prefix('sync')->group(function () {
            Route::post('/pull', [SyncController::class, 'pull']);
            Route::post('/push', [SyncController::class, 'push']);
            Route::get('/quota', [SyncController::class, 'quota']);
            Route::post('/blobs/check', [BlobController::class, 'check']);
            Route::middleware('throttle:120,1')->post('/blobs/{sha}/init', [BlobController::class, 'init']);
            Route::middleware('throttle:600,1')->put('/blobs/{sha}/chunk', [BlobController::class, 'chunk']);
            Route::middleware('throttle:120,1')->post('/blobs/{sha}/complete', [BlobController::class, 'complete']);
            Route::middleware('throttle:600,1')->get('/blobs/{sha}/raw', [BlobController::class, 'raw']);
        });

        Route::prefix('videos')->group(function () {
            Route::get('/catalog', [VideoController::class, 'clientCatalog']);
            Route::middleware('throttle:20,1')->post('/reference-assets', [VideoController::class, 'clientUploadReference']);
            Route::middleware('throttle:30,1')->post('/tasks', [VideoController::class, 'clientSubmit']);
            Route::get('/tasks', [VideoController::class, 'clientTasks']);
            Route::get('/tasks/{taskId}', [VideoController::class, 'clientShow']);
            Route::post('/tasks/{taskId}/refresh', [VideoController::class, 'clientRefresh']);
            Route::post('/tasks/{taskId}/cancel', [VideoController::class, 'clientCancel']);
            Route::get('/usage', [VideoController::class, 'clientUsage']);
        });
        // 图片生成参考图上传：换公网 URL 给「只收 URL」的服务商（多米）。素材落 image 临时素材，6h 过期由 purge 清理。
        Route::prefix('images')->group(function () {
            Route::middleware('throttle:30,1')->post('/reference-assets', [VideoController::class, 'clientUploadImageReference']);
        });
        Route::get('/my-plans', [PlanController::class, 'myPlans']);
        Route::get('/plans', [PlanController::class, 'clientList']);
        Route::post('/redeem', [RedeemController::class, 'redeem']);
        // 订单（收费购买，微信支付通道）
        Route::post('/orders', [PaymentController::class, 'create']);
        Route::post('/orders/upgrade', [PaymentController::class, 'createUpgradeOrder']);
        Route::get('/orders/{orderNo}', [PaymentController::class, 'show']);
        Route::post('/orders/{orderNo}/cancel', [PaymentController::class, 'cancel']);
        // 订单（天阙支付通道）：天阙无异步 notify，需客户端轮询 sync 同步
        Route::post('/orders/tianque', [PaymentController::class, 'createTianque']);
        Route::post('/orders/tianque/upgrade', [PaymentController::class, 'createTianqueUpgrade']);
        Route::post('/orders/{orderNo}/tianque-sync', [PaymentController::class, 'tianqueSync']);
        // 订单（虎皮椒支付通道）：有异步 notify，同时保留客户端轮询 sync 兜底
        Route::post('/orders/xunhupay', [PaymentController::class, 'createXunhupay']);
        Route::post('/orders/xunhupay/upgrade', [PaymentController::class, 'createXunhupayUpgrade']);
        Route::post('/orders/{orderNo}/xunhupay-sync', [PaymentController::class, 'xunhupaySync']);
        // 直充（按金额/档位充值金币或积分；查询/取消复用 /orders/{orderNo} 与 tianque-sync）
        Route::get('/recharge/config', [RechargeController::class, 'clientConfig']);
        // 桌面端左侧菜单配置（显隐 + 自定义名称）
        Route::get('/desktop-menu', [DesktopMenuController::class, 'clientConfig']);
        Route::middleware('throttle:30,1')->post('/recharge/order', [PaymentController::class, 'createRecharge']);
        Route::middleware('throttle:30,1')->post('/recharge/order/tianque', [PaymentController::class, 'createTianqueRecharge']);
        Route::middleware('throttle:30,1')->post('/recharge/order/xunhupay', [PaymentController::class, 'createXunhupayRecharge']);

        Route::prefix('oem-channel')->group(function () {
            Route::get('/profile', [OemChannelController::class, 'profile']);
            Route::get('/summary', [OemChannelController::class, 'summary']);
            Route::get('/orders', [OemChannelController::class, 'orders']);
            Route::get('/commissions', [OemChannelController::class, 'commissions']);
        });

        // 灵感广场上传（需「灵感大王」权限，controller 内做二次校验）
        // 限流：每分钟 30 次，避免恶意刷量；图片上传走 multipart/form-data
        Route::middleware('throttle:30,1')->post('/inspirations', [InspirationController::class, 'clientUpload']);
        Route::middleware('throttle:30,1')->post('/creative-templates/submit', [CreativeTemplateController::class, 'clientSubmit']);
        Route::post('/creative-templates/status-batch', [CreativeTemplateController::class, 'clientStatusBatch']);
        Route::delete('/creative-templates/{localId}/submit', [CreativeTemplateController::class, 'clientWithdraw']);

        // 智能体市场：桌面端投稿 / 状态轮询 / 撤回 / 评分
        Route::middleware('throttle:30,1')->post('/agents/submit', [AgentController::class, 'clientSubmit']);
        Route::post('/agents/status-batch', [AgentController::class, 'clientStatusBatch']);
        Route::delete('/agents/{localId}/submit', [AgentController::class, 'clientWithdraw']);
        Route::middleware('throttle:60,1')->post('/agents/{id}/rate', [AgentController::class, 'rate'])->whereNumber('id');
        // 智能体市场：购买/获取（保存到本地前调用，免费则记拥有，收费则扣金币/积分，余额不足返回 402）
        Route::middleware('throttle:60,1')->post('/agents/{id}/acquire', [AgentController::class, 'acquire'])->whereNumber('id');

        // 云端知识库：桌面端对话 RAG 在线检索（鉴权随智能体授权传递：登录 + 已 acquire + 仅检索绑定库）
        Route::middleware('throttle:120,1')->post('/knowledge-bases/search', [KnowledgeBaseController::class, 'clientSearch']);

        Route::post('/agents/{localId}/share', [AgentHubController::class, 'shareToHub'])->whereNumber('localId');
        Route::delete('/agents/{localId}/share', [AgentHubController::class, 'withdrawFromHub'])->whereNumber('localId');

        Route::post('/creative-templates/{localId}/share', [CreativeTemplateHubController::class, 'shareToHub'])->whereNumber('localId');
        Route::delete('/creative-templates/{localId}/share', [CreativeTemplateHubController::class, 'withdrawFromHub'])->whereNumber('localId');

        // 本地灵感 -> 共享灵感库交互（分享/撤回）。Controller 内部校验 uploader 或 admin
        Route::post('/inspirations/{localId}/share', [InspirationHubController::class, 'shareToHub'])->whereNumber('localId');
        Route::delete('/inspirations/{localId}/share', [InspirationHubController::class, 'withdrawFromHub'])->whereNumber('localId');

        // 共享灵感库浏览 / 状态同步 / 举报（任何登录用户可调）。
        // 字面量路由必须先于 /{hubId} 动态参数路由。
        Route::prefix('inspiration-hub')->group(function () {
            Route::get('/me',           [InspirationHubController::class, 'me']);
            Route::get('/categories',   [InspirationHubController::class, 'categories']);
            Route::get('/list',         [InspirationHubController::class, 'list']);
            Route::post('/status-batch', [InspirationHubController::class, 'statusBatch']);
            Route::post('/{hubId}/report', [InspirationHubController::class, 'report'])->whereNumber('hubId');
            Route::get('/{hubId}',      [InspirationHubController::class, 'show'])->whereNumber('hubId');
        });

        Route::prefix('skills')->group(function () {
            Route::get('/catalog', [SkillCatalogClientController::class, 'catalog']);
            Route::post('/versions/{versionId}/download-ticket', [SkillCatalogClientController::class, 'downloadTicket']);
            Route::get('/download/{token}', [SkillCatalogClientController::class, 'download']);
        });

        Route::prefix('creative-template-hub')->group(function () {
            Route::get('/me', [CreativeTemplateHubController::class, 'me']);
            Route::get('/categories', [CreativeTemplateHubController::class, 'categories']);
            Route::get('/list', [CreativeTemplateHubController::class, 'list']);
            Route::post('/status-batch', [CreativeTemplateHubController::class, 'statusBatch']);
            Route::post('/{hubId}/report', [CreativeTemplateHubController::class, 'report'])->whereNumber('hubId');
            Route::get('/{hubId}', [CreativeTemplateHubController::class, 'show'])->whereNumber('hubId');
        });

        // 智能体共享库浏览 / 状态同步 / 举报（任何登录用户可调）。
        // 字面量路由必须先于 /{hubId} 动态参数路由。
        Route::prefix('agent-hub')->group(function () {
            Route::get('/me', [AgentHubController::class, 'me']);
            Route::get('/categories', [AgentHubController::class, 'categories']);
            Route::get('/list', [AgentHubController::class, 'list']);
            Route::post('/status-batch', [AgentHubController::class, 'statusBatch']);
            Route::post('/{hubId}/report', [AgentHubController::class, 'report'])->whereNumber('hubId');
            Route::get('/{hubId}', [AgentHubController::class, 'show'])->whereNumber('hubId');
        });

        // 公告：客户端拉当前启用的最新一条（桌面端登录后 fetchCloudData 会调一次）
        Route::get('/announcement/current', [AnnouncementController::class, 'current']);

        // 文档站客户端（已登录用户浏览，不受 docs_guest_access 限制）
        // 复用 publicConfig/publicCategories/publicList/publicShow —— 它们内部 ensureAccessAllowed
        // 检测到 auth()->check()=true 时直接放行
        Route::prefix('docs')->group(function () {
            Route::get('/config',     [DocController::class, 'publicConfig']);
            Route::get('/categories', [DocController::class, 'publicCategories']);
            Route::get('/list',       [DocController::class, 'publicList']);
            // 已登录用户的 RAG 流式问答（限流 60/min；字面量必须先于 /{idOrSlug}）
            Route::middleware('throttle:60,1')->post('/chat', [DocController::class, 'clientChat']);
            Route::get('/{idOrSlug}', [DocController::class, 'publicShow']);
        });
    });

    // Gateway (model proxy)
    Route::prefix('gateway')->group(function () {
        Route::post('/chat/completions', [GatewayController::class, 'chatCompletions']);
        Route::post('/images/generations', [GatewayController::class, 'imageGenerations']);
        Route::post('/images/edits', [GatewayController::class, 'imageEdits']);
        Route::get('/images/status/{taskId}', [GatewayController::class, 'imageTaskStatus']);
        Route::post('/embeddings', [GatewayController::class, 'embeddings']);

        // AI 抠图（阿里 viapi SegmentHDCommonImage）
        // 提交 throttle:30/min 防刷；轮询 throttle:600/min 允许 1s 高频
        Route::prefix('matting')->group(function () {
            Route::middleware('throttle:30,1')->post('/segment', [MattingController::class, 'segment']);
            Route::middleware('throttle:600,1')->get('/status/{taskId}', [MattingController::class, 'status']);
            Route::get('/quota', [MattingController::class, 'myQuota']);
            Route::get('/tasks', [MattingController::class, 'myTasks']);
        });

        // 精细抠图（抠抠图 koukoutu 异步 API，按尺寸三档计费，全站并发 5）
        // 提交 throttle:30/min 防刷；轮询 throttle:600/min 允许 1s 高频
        Route::prefix('fine-matting')->group(function () {
            Route::middleware('throttle:30,1')->post('/segment', [FineMattingController::class, 'segment']);
            Route::middleware('throttle:600,1')->get('/status/{taskId}', [FineMattingController::class, 'status']);
            Route::get('/quota', [FineMattingController::class, 'myQuota']);
            Route::get('/tasks', [FineMattingController::class, 'myTasks']);
        });

        // 去AI标记（本地清除元数据/溯源标识，处理成功后按次扣费；request_id 幂等）
        Route::prefix('watermark-removal')->group(function () {
            Route::middleware('throttle:60,1')->post('/charge', [\App\Http\Controllers\WatermarkRemovalController::class, 'charge']);
        });
    });

    // ========== Admin Only ==========
    Route::middleware('admin')->prefix('admin')->group(function () {

        // AI Deck 资源资产(ffmpeg / 模板包): 自检完备性 + 一键拉取缺失(下载+首次自算SHA256固化)+ 列表/删除
        Route::get('/deck-assets', [DeckResourceAssetController::class, 'index']);
        Route::get('/deck-assets/check', [DeckResourceAssetController::class, 'check']);
        Route::post('/deck-assets/sync', [DeckResourceAssetController::class, 'sync']);
        Route::post('/deck-assets', [DeckResourceAssetController::class, 'store']);
        Route::post('/deck-assets/bulk-import', [DeckResourceAssetController::class, 'bulkImport']);
        Route::post('/deck-assets/pull-pending', [DeckResourceAssetController::class, 'pullPending']);
        Route::post('/deck-assets/{id}/pull', [DeckResourceAssetController::class, 'pull']);
        Route::delete('/deck-assets/{id}', [DeckResourceAssetController::class, 'destroy']);

        // TTS 供应商(解说合成; key 留服务端)
        Route::get('/tts-providers', [TtsProviderController::class, 'index']);
        Route::post('/tts-providers', [TtsProviderController::class, 'store']);
        Route::put('/tts-providers/{id}', [TtsProviderController::class, 'update']);
        Route::delete('/tts-providers/{id}', [TtsProviderController::class, 'destroy']);
        Route::post('/tts-providers/{id}/test', [TtsProviderController::class, 'testConnection']);

        Route::get('/skills', [SkillCatalogAdminController::class, 'index']);
        Route::post('/skills/sync', [SkillCatalogAdminController::class, 'sync']);
        Route::get('/skills/{skillId}', [SkillCatalogAdminController::class, 'show']);
        Route::put('/skills/{skillId}', [SkillCatalogAdminController::class, 'update']);
        Route::put('/skills/{skillId}/tenants/{tenantId}', [SkillCatalogAdminController::class, 'setTenantPolicy'])->whereNumber('tenantId');

        // Users
        Route::get('/users', [UserController::class, 'index']);
        Route::post('/users', [UserController::class, 'store']);
        Route::get('/users/{id}', [UserController::class, 'show']);
        Route::get('/users/{id}/capabilities', [UserController::class, 'capabilities'])->whereNumber('id');
        Route::put('/users/{id}/capabilities/{key}', [UserController::class, 'updateCapability'])->whereNumber('id');
        Route::put('/users/{id}', [UserController::class, 'update']);
        Route::delete('/users/{id}', [UserController::class, 'destroy']);
        Route::post('/users/batch-delete', [UserController::class, 'batchDestroy']);
        Route::post('/users/batch-set-inspiration', [UserController::class, 'batchSetInspirationUploader']);
        Route::post('/users/{id}/reset-password', [UserController::class, 'resetPassword']);
        Route::post('/users/{id}/toggle-status', [UserController::class, 'toggleStatus']);
        Route::get('/users/{id}/oem-projects', [UserController::class, 'oemProjects']);
        Route::put('/users/{id}/oem-projects', [UserController::class, 'syncOemProjects']);

        // User Groups
        Route::get('/user-groups', [UserGroupController::class, 'index']);
        Route::post('/user-groups', [UserGroupController::class, 'store']);
        Route::get('/user-groups/{id}', [UserGroupController::class, 'show']);
        Route::put('/user-groups/{id}', [UserGroupController::class, 'update']);
        Route::delete('/user-groups/{id}', [UserGroupController::class, 'destroy']);
        Route::post('/user-groups/batch-delete', [UserGroupController::class, 'batchDestroy']);
        Route::post('/user-groups/{id}/members', [UserGroupController::class, 'addMembers']);
        Route::delete('/user-groups/{id}/members', [UserGroupController::class, 'removeMembers']);

        // Cloud Providers
        Route::get('/cloud-providers', [CloudProviderController::class, 'index']);
        // 健康看板聚合数据：必须放在 /{id} 之前，否则会被动态参数吃掉
        Route::get('/cloud-providers/health', [CloudProviderController::class, 'health']);
        Route::post('/cloud-providers', [CloudProviderController::class, 'store']);
        Route::get('/cloud-providers/{id}', [CloudProviderController::class, 'show']);
        Route::put('/cloud-providers/{id}', [CloudProviderController::class, 'update']);
        Route::delete('/cloud-providers/{id}', [CloudProviderController::class, 'destroy']);
        Route::post('/cloud-providers/batch-delete', [CloudProviderController::class, 'batchDestroy']);
        // 测试 / 深度测试 / 拉取模型 都会真实打到上游 API，加节流避免连点被上游限流或拉黑：每分钟最多 20 次
        Route::middleware('throttle:20,1')->group(function () {
            Route::post('/cloud-providers/{id}/test', [CloudProviderController::class, 'testConnection']);
            Route::post('/cloud-providers/{id}/deep-test', [CloudProviderController::class, 'deepTest']);
            Route::post('/cloud-providers/{id}/fetch-models', [CloudProviderController::class, 'fetchModels']);
        });
        // 解除熔断（不打上游，无需 throttle）
        Route::post('/cloud-providers/{id}/recover', [CloudProviderController::class, 'recover']);

        // Provider Credentials（凭证池）
        Route::get('/cloud-providers/{providerId}/credentials', [ProviderCredentialController::class, 'index']);
        Route::post('/cloud-providers/{providerId}/credentials', [ProviderCredentialController::class, 'store']);
        Route::put('/credentials/{id}', [ProviderCredentialController::class, 'update']);
        Route::delete('/credentials/{id}', [ProviderCredentialController::class, 'destroy']);
        Route::post('/credentials/{id}/reactivate', [ProviderCredentialController::class, 'reactivate']);

        // Cloud Models
        Route::get('/cloud-models', [CloudModelController::class, 'index']);
        Route::post('/cloud-models', [CloudModelController::class, 'store']);
        Route::post('/cloud-models/batch', [CloudModelController::class, 'batchStore']);
        Route::get('/cloud-models/{id}', [CloudModelController::class, 'show']);
        Route::put('/cloud-models/{id}', [CloudModelController::class, 'update']);
        Route::delete('/cloud-models/{id}', [CloudModelController::class, 'destroy']);
        Route::post('/cloud-models/batch-delete', [CloudModelController::class, 'batchDestroy']);
        Route::get('/official-model-refs', [OfficialModelRefController::class, 'lookup']);

        // Model Assignments
        Route::get('/model-assignments', [ModelAssignmentController::class, 'index']);
        Route::post('/model-assignments', [ModelAssignmentController::class, 'store']);
        Route::delete('/model-assignments/{id}', [ModelAssignmentController::class, 'destroy']);
        Route::post('/model-assignments/batch-delete', [ModelAssignmentController::class, 'batchDestroy']);
        Route::post('/model-assignments/batch', [ModelAssignmentController::class, 'batchStore']);
        Route::post('/model-assignments/batch-matrix', [ModelAssignmentController::class, 'batchMatrix']);

        // Permissions
        Route::get('/permissions', [PermissionController::class, 'index']);
        Route::post('/permissions', [PermissionController::class, 'store']);
        Route::post('/permissions/batch', [PermissionController::class, 'batchStore']);
        Route::put('/permissions/{id}', [PermissionController::class, 'update']);
        Route::delete('/permissions/{id}', [PermissionController::class, 'destroy']);
        Route::post('/permissions/batch-delete', [PermissionController::class, 'batchDestroy']);

        // Billing Rules
        Route::get('/billing-rules', [BillingRuleController::class, 'index']);
        Route::post('/billing-rules', [BillingRuleController::class, 'store']);
        Route::post('/billing-rules/batch', [BillingRuleController::class, 'batchStore']);
        Route::put('/billing-rules/{id}', [BillingRuleController::class, 'update']);
        Route::delete('/billing-rules/{id}', [BillingRuleController::class, 'destroy']);
        Route::post('/billing-rules/batch-delete', [BillingRuleController::class, 'batchDestroy']);

        // Balances
        Route::get('/balances', [BalanceController::class, 'index']);
        Route::post('/balances/recharge', [BalanceController::class, 'recharge']);
        Route::post('/balances/batch-recharge', [BalanceController::class, 'batchRecharge']);

        // 直充配置 + 快捷档位
        Route::get('/recharge/config', [RechargeController::class, 'adminConfig']);
        Route::put('/recharge/config', [RechargeController::class, 'adminUpdateConfig']);
        Route::get('/recharge/packages', [RechargeController::class, 'adminPackages']);
        Route::post('/recharge/packages', [RechargeController::class, 'adminStorePackage']);
        Route::put('/recharge/packages/{id}', [RechargeController::class, 'adminUpdatePackage'])->whereNumber('id');
        Route::delete('/recharge/packages/{id}', [RechargeController::class, 'adminDeletePackage'])->whereNumber('id');
        // 桌面端左侧菜单配置（显隐 + 自定义名称）
        Route::get('/desktop-menu', [DesktopMenuController::class, 'adminIndex']);
        Route::put('/desktop-menu', [DesktopMenuController::class, 'adminUpdate']);
        // 桌面端自定义菜单项（内部路由 / 外部链接，整体保存）
        Route::get('/desktop-menu/custom-items', [DesktopMenuController::class, 'adminCustomIndex']);
        Route::put('/desktop-menu/custom-items', [DesktopMenuController::class, 'adminCustomUpdate']);

        // Usage Records
        Route::get('/usage-records', [UsageRecordController::class, 'index']);
        Route::get('/usage-records/stats', [UsageRecordController::class, 'stats']);

        // System
        Route::post('/system/clear-cache', [SystemController::class, 'clearCache']);

        // Settings
        Route::get('/settings', [SettingController::class, 'index']);
        Route::put('/settings', [SettingController::class, 'update']);

        // 云同步存储用量管理
        Route::prefix('sync-storage')->group(function () {
            Route::get('/stats', [SyncController::class, 'adminStats']);
            Route::get('/users', [SyncController::class, 'adminUsers']);
            Route::post('/reconcile', [SyncController::class, 'adminReconcile']);
            Route::post('/users/{userId}/recompute', [SyncController::class, 'adminRecompute'])->whereNumber('userId');
        });
        Route::post('/settings/wxpay-test', [SettingController::class, 'wxpayTest']);
        Route::post('/settings/cos-test', [SettingController::class, 'cosTest']);
        Route::post('/settings/oss-test', [SettingController::class, 'ossTest']);
        // 发送测试短信：会真实消耗额度，严格限流 5/min
        Route::middleware('throttle:5,1')->post('/settings/sms-test', [SettingController::class, 'smsTest']);

        // Payment Orders
        Route::get('/orders', [PaymentController::class, 'adminIndex']);
        Route::get('/orders/{id}', [PaymentController::class, 'adminShow']);
        Route::post('/orders/{id}/sync', [PaymentController::class, 'adminSync']);
        Route::delete('/orders/{id}', [PaymentController::class, 'adminDestroy']);
        Route::get('/commission-orders/options', [OemCommissionController::class, 'options']);
        Route::get('/commission-orders', [OemCommissionController::class, 'index']);
        Route::get('/commission-orders/{id}', [OemCommissionController::class, 'show']);

        // Redeem Codes
        Route::get('/redeem-codes', [RedeemController::class, 'index']);
        Route::post('/redeem-codes', [RedeemController::class, 'store']);
        Route::post('/redeem-codes/batch', [RedeemController::class, 'batchGenerate']);
        Route::put('/redeem-codes/{id}', [RedeemController::class, 'update']);
        Route::delete('/redeem-codes/{id}', [RedeemController::class, 'destroy']);
        Route::post('/redeem-codes/batch-delete', [RedeemController::class, 'batchDestroy']);
        Route::get('/redeem-records', [RedeemController::class, 'records']);

        // Plans
        Route::get('/plan-categories', [PlanController::class, 'categoryIndex']);
        Route::post('/plan-categories', [PlanController::class, 'categoryStore']);
        Route::put('/plan-categories/{id}', [PlanController::class, 'categoryUpdate']);
        Route::delete('/plan-categories/{id}', [PlanController::class, 'categoryDestroy']);
        Route::get('/plans', [PlanController::class, 'index']);
        Route::get('/plans/{id}', [PlanController::class, 'show']);
        Route::post('/plans', [PlanController::class, 'store']);
        Route::put('/plans/{id}', [PlanController::class, 'update']);
        Route::delete('/plans/{id}', [PlanController::class, 'destroy']);
        Route::post('/plans/batch-delete', [PlanController::class, 'batchDestroy']);
        Route::post('/users/{userId}/plans', [PlanController::class, 'grant']);
        Route::post('/plans/batch-grant', [PlanController::class, 'batchGrant']);
        Route::post('/user-plans/{id}/revoke', [PlanController::class, 'revoke']);
        Route::post('/user-plans/batch-revoke', [PlanController::class, 'batchRevoke']);
        Route::get('/user-plans', [PlanController::class, 'userPlans']);
        Route::get('/user-plan-quotas', [PlanController::class, 'userPlanQuotas']);

        // Online Updates
        // throttle 放宽：前端升级中 1.5s 轮询 progress，多 tab / 多次重试不应被默认 60/min 限流
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

        // Cloud Build (white-label desktop apps) — talks to agent-build over HMAC
        Route::prefix('cloud-build')->group(function () {
            Route::get('/auth-check', [CloudBuildController::class, 'authCheck']);
            Route::get('/github-settings', [\App\Http\Controllers\CloudBuild\CloudBuildGitHubSettingsController::class, 'show']);
            Route::put('/github-settings', [\App\Http\Controllers\CloudBuild\CloudBuildGitHubSettingsController::class, 'update']);
            Route::get('/template-info', [CloudBuildController::class, 'templateInfo']);
            Route::get('/profile', [CloudBuildController::class, 'getProfile']);
            Route::put('/profile', [CloudBuildController::class, 'saveProfile']);
            // 1.2.17+ 授权信息：域名对应的姓名 / 电话 / 是否需要完善（needs_completion）
            Route::get('/my-info', [CloudBuildController::class, 'myInfo']);
            Route::put('/my-info', [CloudBuildController::class, 'updateMyInfo']);
            Route::get('/', [CloudBuildController::class, 'index']);
            Route::post('/request', [CloudBuildController::class, 'request']);
            Route::post('/icon', [CloudBuildIconController::class, 'upload']);
            Route::post('/customer-service-image', [CloudBuildIconController::class, 'uploadCustomerServiceImage']);
            Route::post('/login-background', [CloudBuildIconController::class, 'uploadLoginBackground']);
            // 智能体列表页背景图上传（桌面端外观设置用，复用 cloud-build 图片上传基础设施）
            Route::post('/bot-list-background', [CloudBuildIconController::class, 'uploadBotListBackground']);
            // 字面量路由必须先于 /{buildId} 注册，否则会被动态参数吃掉
            Route::delete('/invalid', [CloudBuildController::class, 'cleanupInvalid']);
            Route::get('/installers', [CloudBuildController::class, 'listInstallers']);
            Route::delete('/installers', [CloudBuildController::class, 'deleteInstaller']);
            // 临时下载产物管理（storage/app/cloud-builds/tmp）
            Route::get('/tmp-artifacts', [CloudBuildController::class, 'listTmpArtifacts']);
            Route::post('/tmp-artifacts/cleanup', [CloudBuildController::class, 'cleanupTmpArtifacts']);
            Route::get('/{buildId}', [CloudBuildController::class, 'show']);
            Route::post('/{buildId}/refresh', [CloudBuildController::class, 'refresh']);
            Route::post('/{buildId}/retry', [CloudBuildController::class, 'retry']);
            Route::post('/{buildId}/cancel', [CloudBuildController::class, 'cancel']);
        });

        Route::prefix('oem-projects')->group(function () {
            Route::get('/', [OemProjectController::class, 'index']);
            Route::post('/', [OemProjectController::class, 'store']);
            Route::get('/{projectKey}', [OemProjectController::class, 'show']);
            Route::put('/{projectKey}', [OemProjectController::class, 'update']);
            Route::delete('/{projectKey}', [OemProjectController::class, 'destroy']);
            Route::get('/{projectKey}/members', [OemProjectController::class, 'members']);
            Route::post('/{projectKey}/members', [OemProjectController::class, 'upsertMember']);
            Route::put('/{projectKey}/members', [OemProjectController::class, 'syncMembers']);
            Route::delete('/{projectKey}/members/{userId}', [OemProjectController::class, 'deleteMember'])->whereNumber('userId');
            Route::delete('/{projectKey}/invalid', [OemProjectController::class, 'cleanupInvalid']);
            Route::get('/{projectKey}/installers', [OemProjectController::class, 'listInstallers']);
            Route::delete('/{projectKey}/installers', [OemProjectController::class, 'deleteInstaller']);
            Route::get('/{projectKey}/builds', [OemProjectController::class, 'builds']);
            Route::post('/{projectKey}/builds', [OemProjectController::class, 'requestBuild']);
            Route::get('/{projectKey}/builds/{buildId}', [OemProjectController::class, 'showBuild']);
            Route::post('/{projectKey}/builds/{buildId}/refresh', [OemProjectController::class, 'refreshBuild']);
            Route::post('/{projectKey}/builds/{buildId}/retry', [OemProjectController::class, 'retryBuild']);
            Route::post('/{projectKey}/builds/{buildId}/cancel', [OemProjectController::class, 'cancelBuild']);
        });

        // Homepage settings (官网设置：文本/下载链接/截图 + 行业话术包)
        Route::prefix('homepage')->group(function () {
            Route::get('/settings', [HomepageController::class, 'index']);
            Route::put('/settings', [HomepageController::class, 'update']);
            Route::post('/images', [HomepageController::class, 'uploadImage']);
            Route::delete('/images/{position}', [HomepageController::class, 'deleteImage']);

            // 行业话术包：按模板维度维护多套行业文案预设
            // /apply：把 payload 写入 SystemSetting，前台官网立即换文案
            Route::get('/phrase-packs', [HomepagePhrasePackController::class, 'index']);
            Route::post('/phrase-packs', [HomepagePhrasePackController::class, 'store']);
            Route::get('/phrase-packs/{id}', [HomepagePhrasePackController::class, 'show'])->whereNumber('id');
            Route::put('/phrase-packs/{id}', [HomepagePhrasePackController::class, 'update'])->whereNumber('id');
            Route::delete('/phrase-packs/{id}', [HomepagePhrasePackController::class, 'destroy'])->whereNumber('id');
            Route::post('/phrase-packs/{id}/apply', [HomepagePhrasePackController::class, 'apply'])->whereNumber('id');
        });

        // Creative Templates（创意模板：分类 + 模板 + 三种创建入口的 AI 辅助接口）
        // 路由顺序约束：字面量路由必须先于 /{id} 注册
        Route::prefix('creative-templates')->group(function () {
            // 分类 CRUD
            Route::get   ('/categories',      [CreativeTemplateController::class, 'categoryIndex']);
            Route::post  ('/categories',      [CreativeTemplateController::class, 'categoryStore']);
            Route::put   ('/categories/{id}', [CreativeTemplateController::class, 'categoryUpdate'])->whereNumber('id');
            Route::delete('/categories/{id}', [CreativeTemplateController::class, 'categoryDestroy'])->whereNumber('id');

            // AI 辅助：分析提示词 / 反推图片 / 灵感转草稿；限流 30/min 防恶意刷上游
            Route::middleware('throttle:30,1')->group(function () {
                Route::post('/ai/analyze-prompt',         [CreativeTemplateController::class, 'analyzePrompt']);
                Route::post('/ai/reverse-image',          [CreativeTemplateController::class, 'reverseImage']);
                Route::post('/ai/draft-from-inspiration', [CreativeTemplateController::class, 'draftFromInspiration']);
            });
            Route::get('/ai/models', [CreativeTemplateController::class, 'aiModels']);

            // 模板 CRUD（含批量删）
            Route::post('/batch-delete', [CreativeTemplateController::class, 'batchDestroy']);
            Route::post('/{id}/approve', [CreativeTemplateController::class, 'approve'])->whereNumber('id');
            Route::post('/{id}/reject', [CreativeTemplateController::class, 'reject'])->whereNumber('id');
            Route::put('/{id}/visibility', [CreativeTemplateController::class, 'setVisibility'])->whereNumber('id');
            Route::put('/{id}/sort-order', [CreativeTemplateController::class, 'setSortOrder'])->whereNumber('id');
            Route::get   ('/',        [CreativeTemplateController::class, 'index']);
            Route::post  ('/',        [CreativeTemplateController::class, 'store']);
            Route::get   ('/{id}',    [CreativeTemplateController::class, 'show'])->whereNumber('id');
            Route::put   ('/{id}',    [CreativeTemplateController::class, 'update'])->whereNumber('id');
            Route::delete('/{id}',    [CreativeTemplateController::class, 'destroy'])->whereNumber('id');
        });

        // Style Presets（风格预设：生图风格提示词片段的后台管理，桌面端经 /public/style-presets/* 拉取）
        // 路由顺序约束：字面量路由必须先于 /{id} 注册
        Route::prefix('style-presets')->group(function () {
            Route::get('/categories',       [StylePresetController::class, 'categories']);
            Route::put('/{id}/toggle',      [StylePresetController::class, 'toggle'])->whereNumber('id');
            Route::put('/{id}/sort-order',  [StylePresetController::class, 'setSortOrder'])->whereNumber('id');
            Route::get   ('/',        [StylePresetController::class, 'index']);
            Route::post  ('/',        [StylePresetController::class, 'store']);
            Route::put   ('/{id}',    [StylePresetController::class, 'update'])->whereNumber('id');
            Route::delete('/{id}',    [StylePresetController::class, 'destroy'])->whereNumber('id');
        });

        // 智能体市场（管理端：CRUD + 启停 + 批量启停 + 投稿审核）
        // 路由顺序约束：字面量 / 批量路由必须先于 /{id} 注册
        Route::prefix('agents')->group(function () {
            // 分类 CRUD（字面量路由必须先于 /{id} 注册）
            Route::get   ('/categories',      [AgentController::class, 'categoryIndex']);
            Route::post  ('/categories',      [AgentController::class, 'categoryStore']);
            Route::put   ('/categories/{id}', [AgentController::class, 'categoryUpdate'])->whereNumber('id');
            Route::delete('/categories/{id}', [AgentController::class, 'categoryDestroy'])->whereNumber('id');

            Route::post('/batch-delete',     [AgentController::class, 'batchDestroy']);
            Route::post('/batch-visibility', [AgentController::class, 'batchSetVisibility']);
            Route::post('/{id}/approve',     [AgentController::class, 'approve'])->whereNumber('id');
            Route::post('/{id}/reject',      [AgentController::class, 'reject'])->whereNumber('id');
            Route::put ('/{id}/visibility',  [AgentController::class, 'setVisibility'])->whereNumber('id');
            Route::put ('/{id}/sort-order',  [AgentController::class, 'setSortOrder'])->whereNumber('id');
            Route::get   ('/',     [AgentController::class, 'index']);
            Route::post  ('/',     [AgentController::class, 'store']);
            Route::get   ('/{id}', [AgentController::class, 'show'])->whereNumber('id');
            Route::put   ('/{id}', [AgentController::class, 'update'])->whereNumber('id');
            Route::delete('/{id}', [AgentController::class, 'destroy'])->whereNumber('id');
        });

        // Inspirations (灵感广场数据管理)
        Route::prefix('inspirations')->group(function () {
            Route::get('/config', [InspirationController::class, 'getConfig']);
            Route::put('/config', [InspirationController::class, 'updateConfig']);
            Route::get('/categories', [InspirationController::class, 'categoryIndex']);
            Route::post('/categories', [InspirationController::class, 'categoryStore']);
            Route::put('/categories/{id}', [InspirationController::class, 'categoryUpdate']);
            Route::delete('/categories/{id}', [InspirationController::class, 'categoryDestroy']);
            Route::get('/', [InspirationController::class, 'index']);
            Route::post('/', [InspirationController::class, 'store']);
            Route::put('/{id}', [InspirationController::class, 'update']);
            Route::delete('/{id}', [InspirationController::class, 'destroy']);
            Route::post('/batch-delete', [InspirationController::class, 'batchDestroy']);
            // 1.2.16+ 审核 + 显示开关
            Route::post('/{id}/approve', [InspirationController::class, 'approve']);
            Route::post('/{id}/reject', [InspirationController::class, 'reject']);
            Route::put('/{id}/visibility', [InspirationController::class, 'setVisibility']);
        });

        // Inspiration Hub（共享灵感库 - 后台管理层）
        // 路由顺序约束：字面量（settings/health-check/pending-list）必须先于 /{hubId}
        Route::prefix('inspiration-hub')->group(function () {
            // settings 已并入云打包配置（cloudbuild.agent_build.base_url + 自动 host 推导），
            // 仅保留 GET 用于后台展示当前生效值；不再接受手工填写。
            Route::get('/settings',     [InspirationHubController::class, 'adminGetSettings']);
            Route::post('/health-check', [InspirationHubController::class, 'adminHealthCheck']);
            Route::get('/pending-list', [InspirationHubController::class, 'adminPendingList']);
            Route::post('/{hubId}/review',         [InspirationHubController::class, 'adminReview'])->whereNumber('hubId');
            Route::post('/{hubId}/pull-to-local',  [InspirationHubController::class, 'adminPullToLocal'])->whereNumber('hubId');
        });

        Route::prefix('creative-template-hub')->group(function () {
            Route::get('/settings', [CreativeTemplateHubController::class, 'adminGetSettings']);
            Route::post('/health-check', [CreativeTemplateHubController::class, 'adminHealthCheck']);
            Route::get('/pending-list', [CreativeTemplateHubController::class, 'adminPendingList']);
            Route::post('/{hubId}/review', [CreativeTemplateHubController::class, 'adminReview'])->whereNumber('hubId');
            Route::post('/{hubId}/pull-to-local', [CreativeTemplateHubController::class, 'adminPullToLocal'])->whereNumber('hubId');
        });

        // Agent Hub（智能体共享库 - 后台管理层）
        // 路由顺序约束：字面量（settings/health-check/pending-list）必须先于 /{hubId}
        Route::prefix('agent-hub')->group(function () {
            Route::get('/settings', [AgentHubController::class, 'adminGetSettings']);
            Route::post('/health-check', [AgentHubController::class, 'adminHealthCheck']);
            Route::get('/pending-list', [AgentHubController::class, 'adminPendingList']);
            Route::post('/{hubId}/review', [AgentHubController::class, 'adminReview'])->whereNumber('hubId');
            Route::post('/{hubId}/pull-to-local', [AgentHubController::class, 'adminPullToLocal'])->whereNumber('hubId');
        });

        Route::get('/shared-hub/sync', [SharedHubSyncController::class, 'status']);
        Route::post('/shared-hub/sync', [SharedHubSyncController::class, 'sync']);

        // AI 抠图（阿里 viapi）管理后台
        Route::prefix('matting')->group(function () {
            Route::get('/stats',             [MattingController::class, 'adminStats']);
            // 自定义设置（v1.5.0+ AK/SK / endpoint / credit_per_call 改后台 UI 配置，不再走 .env）
            Route::get('/settings',          [MattingController::class, 'adminGetSettings']);
            Route::put('/settings',          [MattingController::class, 'adminUpdateSettings']);
            Route::get('/tasks',             [MattingController::class, 'adminIndex']);
            Route::post('/tasks/batch-delete', [MattingController::class, 'adminBatchDestroy']);
            Route::get('/tasks/{taskId}',    [MattingController::class, 'adminShow']);
            Route::delete('/tasks/{taskId}', [MattingController::class, 'adminDestroy']);
            // 管理员测试调用：上传一张图直接跑通端到端（验证当前自定义设置是否可用）
            Route::middleware('throttle:10,1')->post('/test', [MattingController::class, 'adminTest']);
        });

        // 精细抠图（抠抠图 koukoutu）管理后台
        Route::prefix('fine-matting')->group(function () {
            Route::get('/stats',               [FineMattingController::class, 'adminStats']);
            // 自定义设置（API Key / 三档单价 / 三档尺寸阈值 / 启用开关）
            Route::get('/settings',            [FineMattingController::class, 'adminGetSettings']);
            Route::put('/settings',            [FineMattingController::class, 'adminUpdateSettings']);
            Route::get('/tasks',               [FineMattingController::class, 'adminIndex']);
            Route::post('/tasks/batch-delete', [FineMattingController::class, 'adminBatchDestroy']);
            Route::get('/tasks/{taskId}',      [FineMattingController::class, 'adminShow']);
            Route::delete('/tasks/{taskId}',   [FineMattingController::class, 'adminDestroy']);
            // 管理员测试调用：上传一张图直接跑通端到端
            Route::middleware('throttle:10,1')->post('/test', [FineMattingController::class, 'adminTest']);
        });

        // 店铺商品图（ewei 等第三方商城对接）：第一级授权态查询 + 立即刷新
        // 第二级 per-user 权限复用 /admin/permissions；商城显示名等基础设置复用 /admin/settings
        Route::prefix('ewei-shop')->group(function () {
            Route::get('/authorization', [\App\Http\Controllers\EweiShopController::class, 'authorization']);
            Route::post('/refresh-auth', [\App\Http\Controllers\EweiShopController::class, 'refreshAuth']);
        });

        Route::prefix('videos')->group(function () {
            Route::get('/stats', [VideoController::class, 'adminStats']);
            Route::get('/accounts', [VideoController::class, 'adminAccounts']);
            Route::post('/accounts', [VideoController::class, 'adminStoreAccount']);
            Route::put('/accounts/{id}', [VideoController::class, 'adminUpdateAccount'])->whereNumber('id');
            Route::delete('/accounts/{id}', [VideoController::class, 'adminDeleteAccount'])->whereNumber('id');
            Route::post('/accounts/{id}/test', [VideoController::class, 'adminTestAccount'])->whereNumber('id');
            Route::post('/accounts/{id}/fetch-models', [VideoController::class, 'adminFetchProviderModels'])->whereNumber('id');
            Route::post('/accounts/{id}/import-models', [VideoController::class, 'adminImportProviderModels'])->whereNumber('id');
            Route::get('/models', [VideoController::class, 'adminModelSpecs']);
            Route::get('/catalog-diagnostics', [VideoController::class, 'adminCatalogDiagnostics']);
            Route::post('/models', [VideoController::class, 'adminStoreModelSpec']);
            Route::put('/models/{id}', [VideoController::class, 'adminUpdateModelSpec'])->whereNumber('id');
            Route::delete('/models/{id}', [VideoController::class, 'adminDeleteModelSpec'])->whereNumber('id');
            Route::get('/skus', [VideoController::class, 'adminSkus']);
            Route::post('/skus', [VideoController::class, 'adminStoreSku']);
            Route::put('/skus/{id}', [VideoController::class, 'adminUpdateSku'])->whereNumber('id');
            Route::delete('/skus/{id}', [VideoController::class, 'adminDeleteSku'])->whereNumber('id');
            Route::post('/skus/batch-update', [VideoController::class, 'adminBatchUpdateSkus']);
            Route::get('/pricing-rules', [VideoController::class, 'adminPricingRules']);
            Route::post('/pricing-rules', [VideoController::class, 'adminStorePricingRule']);
            Route::post('/pricing-rules/batch', [VideoController::class, 'adminBatchStorePricingRules']);
            Route::post('/pricing-rules/batch-discount', [VideoController::class, 'adminBatchStorePricingRuleDiscounts']);
            Route::put('/pricing-rules/{id}', [VideoController::class, 'adminUpdatePricingRule'])->whereNumber('id');
            Route::delete('/pricing-rules/{id}', [VideoController::class, 'adminDeletePricingRule'])->whereNumber('id');
            Route::get('/tasks', [VideoController::class, 'adminTasks']);
            Route::post('/tasks/batch-delete', [VideoController::class, 'adminBatchDeleteTasks']);
            Route::get('/tasks/{taskId}', [VideoController::class, 'adminShowTask']);
            Route::post('/tasks/{taskId}/refresh', [VideoController::class, 'adminRefreshTask']);
            Route::post('/tasks/{taskId}/cancel', [VideoController::class, 'adminCancelTask']);
            Route::delete('/tasks/{taskId}', [VideoController::class, 'adminDeleteTask']);
            Route::get('/usage', [VideoController::class, 'adminUsage']);
            // 临时参考素材（桌面端上传的视频参考图/视频/音频，24h 过期）：列表 / 统计 / 清理 / 删除
            // 字面量路由必须先于 /{id} 注册，否则会被动态参数吞掉
            Route::get('/reference-assets/stats', [VideoController::class, 'adminReferenceAssetStats']);
            Route::post('/reference-assets/cleanup-expired', [VideoController::class, 'adminCleanupExpiredReferenceAssets']);
            Route::post('/reference-assets/batch-delete', [VideoController::class, 'adminBatchDeleteReferenceAssets']);
            Route::get('/reference-assets', [VideoController::class, 'adminReferenceAssets']);
            Route::delete('/reference-assets/{id}', [VideoController::class, 'adminDeleteReferenceAsset'])->whereNumber('id');
        });

        // Announcements（公告管理：标题 + 富文本，客户端只拉 enabled=1 的最新一条）
        Route::prefix('announcements')->group(function () {
            Route::get('/', [AnnouncementController::class, 'index']);
            Route::post('/', [AnnouncementController::class, 'store']);
            // 公告插图上传：置于 {id} 通配路由之前，避免字面量段被当作 id 解析
            Route::post('/upload-image', [AnnouncementController::class, 'uploadImage']);
            Route::get('/{id}', [AnnouncementController::class, 'show']);
            Route::put('/{id}', [AnnouncementController::class, 'update']);
            Route::delete('/{id}', [AnnouncementController::class, 'destroy']);
            Route::post('/{id}/toggle', [AnnouncementController::class, 'toggle']);
        });

        // Documents（文档管理：分类 + 文档 + 设置 + 导入 + 富文本图片上传 + RAG 索引/检索/测试）
        // 路由顺序约束：字面量路由必须先于 /{id} 注册，否则会被动态参数吃掉（cloud-build 同理）
        Route::prefix('docs')->group(function () {
            // 设置（含 RAG 配置 + 可用模型下拉 + 统计）
            Route::get('/config', [DocController::class, 'getConfig']);
            Route::put('/config', [DocController::class, 'updateConfig']);
            // 分类 CRUD
            Route::get   ('/categories',      [DocController::class, 'categoryIndex']);
            Route::post  ('/categories',      [DocController::class, 'categoryStore']);
            Route::put   ('/categories/{id}', [DocController::class, 'categoryUpdate']);
            Route::delete('/categories/{id}', [DocController::class, 'categoryDestroy']);
            // 批量 + 字面量端点（必须先于 /{id} 注册）
            Route::post('/batch-delete',     [DocController::class, 'batchDestroy']);
            Route::post('/batch-visibility', [DocController::class, 'batchSetVisibility']);
            // 导入 docx/md 限流 10/min，批量 5/min（单次 ≤50 个），富文本嵌入图片上传 60/min
            Route::middleware('throttle:10,1')->post('/import',       [DocController::class, 'import']);
            Route::middleware('throttle:5,1') ->post('/batch-import', [DocController::class, 'batchImport']);
            Route::middleware('throttle:60,1')->post('/upload-image', [DocController::class, 'uploadImage']);
            // 导出 md（单条 + 批量 zip）；批量限流 10/min 防被刷
            Route::get('/{id}/export.md',                              [DocController::class, 'exportOne']);
            Route::middleware('throttle:10,1')->post('/export-batch', [DocController::class, 'exportBatch']);
            // RAG 字面量端点（必须先于 /{id} 注册；reindex-all 全量重建可能耗时几分钟）
            Route::middleware('throttle:30,5')->post('/reindex-all',     [DocController::class, 'reindexAll']);
            Route::middleware('throttle:60,1')->post('/retrieve-preview', [DocController::class, 'retrievePreview']);
            Route::middleware('throttle:30,1')->post('/test-model',       [DocController::class, 'testModel']);
            Route::get('/chat-logs', [DocController::class, 'chatLogs']);
            // 文档 CRUD（/ 和 /{id}；/{id}/visibility 和 /{id}/reindex 字面量必须先于 /{id}）
            Route::get ('/',                [DocController::class, 'index']);
            Route::post('/',                [DocController::class, 'store']);
            Route::put ('/{id}/visibility', [DocController::class, 'setVisibility']);
            Route::middleware('throttle:60,1')->post('/{id}/reindex', [DocController::class, 'reindexOne']);
            Route::get   ('/{id}', [DocController::class, 'show']);
            Route::put   ('/{id}', [DocController::class, 'update']);
            Route::delete('/{id}', [DocController::class, 'destroy']);
        });

        // Knowledge Bases（云端知识库：库 CRUD + 文档 + 文件上传解析 + 异步向量化 + hybrid 检索调试）
        // 路由顺序约束：字面量 / 嵌套字面量必须先于 /{id} 注册，否则被动态参数吃掉
        Route::prefix('knowledge-bases')->group(function () {
            // 设置（embedding 模型 + 切片/检索参数 + 统计 + Qdrant 健康）
            Route::get('/config', [KnowledgeBaseController::class, 'getConfig']);
            Route::put('/config', [KnowledgeBaseController::class, 'updateConfig']);
            // 智能体绑定下拉用的轻量列表
            Route::get('/options', [KnowledgeBaseController::class, 'options']);
            // 检索调试 + 模型测试 + 富文本图片上传（字面量先于 /{id}）
            Route::middleware('throttle:60,1')->post('/retrieve-preview', [KnowledgeBaseController::class, 'retrievePreview']);
            Route::middleware('throttle:30,1')->post('/test-model',       [KnowledgeBaseController::class, 'testModel']);
            Route::middleware('throttle:60,1')->post('/upload-image',     [KnowledgeBaseController::class, 'uploadImage']);
            // 文档（嵌套在 {kbId} 下；嵌套字面量先于 /{id}）
            Route::get ('/{kbId}/documents',                 [KnowledgeBaseController::class, 'listDocuments'])->whereNumber('kbId');
            Route::post('/{kbId}/documents',                 [KnowledgeBaseController::class, 'storeDocument'])->whereNumber('kbId');
            Route::middleware('throttle:10,1')->post('/{kbId}/import', [KnowledgeBaseController::class, 'import'])->whereNumber('kbId');
            Route::middleware('throttle:30,5')->post('/{kbId}/reindex', [KnowledgeBaseController::class, 'reindexKb'])->whereNumber('kbId');
            Route::get   ('/{kbId}/documents/{docId}', [KnowledgeBaseController::class, 'showDocument'])->whereNumber('kbId')->whereNumber('docId');
            Route::put   ('/{kbId}/documents/{docId}', [KnowledgeBaseController::class, 'updateDocument'])->whereNumber('kbId')->whereNumber('docId');
            Route::delete('/{kbId}/documents/{docId}', [KnowledgeBaseController::class, 'destroyDocument'])->whereNumber('kbId')->whereNumber('docId');
            Route::middleware('throttle:60,1')->post('/{kbId}/documents/{docId}/reindex', [KnowledgeBaseController::class, 'reindexDocument'])->whereNumber('kbId')->whereNumber('docId');
            // 知识库 CRUD
            Route::get ('/',     [KnowledgeBaseController::class, 'index']);
            Route::post('/',     [KnowledgeBaseController::class, 'store']);
            Route::get   ('/{id}', [KnowledgeBaseController::class, 'show'])->whereNumber('id');
            Route::put   ('/{id}', [KnowledgeBaseController::class, 'update'])->whereNumber('id');
            Route::delete('/{id}', [KnowledgeBaseController::class, 'destroy'])->whereNumber('id');
        });
    });
});
