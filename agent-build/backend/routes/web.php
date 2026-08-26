<?php

use App\Http\Controllers\Build\BuildRequestController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Web Routes
|--------------------------------------------------------------------------
*/

Route::get('/', function () {
    return response()->json([
        'app' => 'agent-build',
        'version' => config('version.version'),
    ]);
});

// 0.5.0 家庭电脑中转方案上线后，/dl/{token} 已下线 —— 云控端 CloudBuildPullService
// 直接拿 mirror_url_primary GET 国内 mirror 站点，不再走 agent-build 服务器流量。
// 老 build_request（cos_object_prefix 非空）的下载链路已失效；如需历史数据回流可走
// admin SystemSettings 重新启用 cos.* 配置 + 还原本文件。

// 管理后台 SPA fallback：/admin 及子路径（除 /admin/api 由 RouteServiceProvider 优先匹配）
// 用户直接访问 /admin/clients 这类路由时回退到打包后的 index.html，让 react-router 接管。
// 静态资源（/admin/assets/index-xxx.js 等）由 Apache/.htaccess 直接送实体文件，不会进到这里。
Route::get('/admin/{any?}', function () {
    $file = public_path('admin/index.html');
    if (!is_file($file)) {
        return response()->json([
            'error' => 'admin_ui_not_built',
            'message' => '前端未构建。在 frontend/ 目录跑 `npm run build` 后再访问。',
        ], 503);
    }
    return response()->file($file);
})->where('any', '.*');
