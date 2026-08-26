<?php

namespace App\Providers;

use App\Services\Knowledge\QdrantVecService;
use App\Services\Knowledge\VecStoreInterface;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register()
    {
        // 知识库向量存储默认实现：Qdrant（后续可替换 pgvector / Milvus 而不改业务层）
        $this->app->bind(VecStoreInterface::class, QdrantVecService::class);

        $this->app->bind(
            \App\Services\CloudBuild\CloudBuildGitHubGateway::class,
            \App\Services\CloudBuild\CloudBuildGitHubDispatchService::class
        );
        $this->app->singleton(\App\Services\CloudBuild\CloudBuildExecutionSettings::class, function () {
            return \App\Services\CloudBuild\CloudBuildExecutionSettings::fromConfig();
        });
        $this->app->singleton(\App\Services\CloudBuild\CloudBuildArtifactStore::class, function ($app) {
            return \App\Services\CloudBuild\CloudBuildArtifactStore::fromSettings(
                $app->make(\App\Services\CloudBuild\CloudBuildExecutionSettings::class)
            );
        });
        $this->app->singleton(\App\Services\CloudBuild\CloudBuildCutoverStore::class, function () {
            return \App\Services\CloudBuild\CloudBuildCutoverStore::fromConfig();
        });
        $this->app->singleton(\App\Services\CloudBuild\CloudBuildBackendSelector::class, function ($app) {
            return \App\Services\CloudBuild\CloudBuildBackendSelector::fromConfig(
                $app->make(\App\Services\CloudBuild\CloudBuildCutoverStore::class)
            );
        });
        $this->app->bind(\App\Services\CloudBuild\CloudBuildBackend::class, function ($app) {
            return $app->make(\App\Services\CloudBuild\CloudBuildBackendSelector::class)->backend();
        });
    }

    public function boot()
    {
        $this->ensureStorageDirs();

        // 仅非生产环境做 mall_key 契约自检（不一致即抛出），避免拖累生产启动。
        if (app()->environment('local', 'testing')) {
            \App\Services\CloudBuild\EweiShopAuthorization::assertContractIntegrity();
        }
    }

    /**
     * 1.2.6 起：运行时自愈 storage / bootstrap/cache 关键子目录。
     *
     * 客户站点偶发现象：
     *   - 维护时清缓存清狠了（rm -rf storage/framework/*）
     *   - 初装解压未保留空目录
     *   - chmod / chown 维护后丢失子目录
     *
     * 任一情况都会导致 config('view.compiled') = realpath(storage/framework/views) = false，
     * Blade Compiler 构造时抛 InvalidArgumentException('Please provide a valid cache path.')。
     * Laravel 异常处理器又会试图渲染 errors/*.blade.php 错误页，再次触发 Blade 编译，
     * 二次 fatal 把原始异常吞掉，给前端返空 body 500，浏览器落到
     * chrome-error://chromewebdata/ 兜底页（看起来「整站根 / 打不开」）。
     *
     * 此处在 boot 阶段做幂等 mkdir，每请求毫秒级耗时，0 风险，无需运维介入。
     * mkdir 失败用 @ 静音（并发请求 race 同一个目录时会有 false，无副作用）。
     */
    private function ensureStorageDirs(): void
    {
        $dirs = [
            storage_path('framework/sessions'),
            storage_path('framework/views'),
            storage_path('framework/cache/data'),
            storage_path('framework/testing'),
            storage_path('logs'),
            storage_path('app/public'),
            storage_path('app/tmp'),
            storage_path('app/skill-catalog'),
            base_path('bootstrap/cache'),
        ];

        foreach ($dirs as $d) {
            if (!is_dir($d)) {
                @mkdir($d, 0775, true);
            }
        }
    }
}
