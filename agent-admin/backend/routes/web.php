<?php

use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Route;

/**
 * 跳到带尾斜杠的子站点入口（/admin/ 或 /docs/）。
 *
 * 不能直接用 redirect('/admin/')：Laravel 的 redirect() helper 内部调 url()→
 * trim($path, '/') 会把首尾斜杠都剥掉，最终 Location 变成 /admin（缺尾斜杠），
 * 浏览器地址栏看着不专业、SEO 也容易出现 /admin 与 /admin/ 双 URL。
 * 用原生 Symfony RedirectResponse 构造，URL 原样进 Location header。
 */
function redirectKeepSlash(string $path): RedirectResponse
{
    return new RedirectResponse($path, 302);
}

Route::get('/', function () {
    // 四档优先级：
    // 1. homepage_enabled=false：根域名 302 → /admin/（与历史行为一致）
    // 2. homepage_use_docs_as_index=true 且文档站启用：根域名 302 → /docs/（admin 显式选了文档当门面）
    //    若选了 use_docs_as_index 但 docs 未启用，回落到官网首页（避免无入口）
    // 3. homepage_template != 'default'：尝试加载 public/home-{template}/index.html，
    //    找不到时回落到默认模板，避免选错模板代号导致空白页
    // 4. 默认：渲染 public/home/index.html（历史官网模板，名为 'default'）
    $enabled = \App\Models\SystemSetting::getValue('homepage_enabled', true);
    if (!$enabled) {
        return redirectKeepSlash('/admin/');
    }
    $useDocs = (bool) \App\Models\SystemSetting::getValue('homepage_use_docs_as_index', false);
    $docsEnabled = (bool) \App\Models\SystemSetting::getValue('docs_enabled', false);
    if ($useDocs && $docsEnabled && file_exists(public_path('docs/index.html'))) {
        return redirectKeepSlash('/docs/');
    }

    // 模板候选：非 default 模板优先尝试，找不到自动回落到 home/index.html
    // 模板代号严格白名单，避免 path traversal（{template} 直接拼路径）
    $template = (string) \App\Models\SystemSetting::getValue('homepage_template', 'default');
    $candidates = [];
    if ($template !== '' && $template !== 'default' && in_array($template, \App\Http\Controllers\HomepageController::TEMPLATES, true)) {
        $candidates[] = public_path("home-{$template}/index.html");
    }
    $candidates[] = public_path('home/index.html');

    foreach ($candidates as $path) {
        if (file_exists($path)) {
            return response(file_get_contents($path), 200)->header('Content-Type', 'text/html');
        }
    }
    return redirectKeepSlash('/admin/');
});

Route::get('/admin/{any?}', function () {
    return file_get_contents(public_path('admin/index.html'));
})->where('any', '.*');

// 文档站 SPA：与 admin 同模式，所有 /docs/* 路由都 fallback 到 docs-frontend index.html
// 静态资源（/docs/assets/*）由 web 服务器直接命中文件，不会走到这里
// docs_enabled 门控由前端拉 /api/public/docs/config 后判定，并显示 DisabledPage（保留无文档时也能进入站点 → 看到提示）
Route::get('/docs/{any?}', function () {
    $path = public_path('docs/index.html');
    if (!file_exists($path)) {
        return response('docs site not deployed', 404);
    }
    return response(file_get_contents($path), 200)->header('Content-Type', 'text/html');
})->where('any', '.*');
