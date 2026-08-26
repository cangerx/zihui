<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * AI Deck 资源资产表（三层分发模型的云控端落点）。
 *   统一承载 ffmpeg/ffprobe 二进制 与 声明式模板包(pptdemo) 两类按需下发资源:
 *   - 上游母 CDN(your-cdn-domain.example.com) 人工上传 → 云控端「一键拉取」下载+首次自算 SHA256 固化入本表
 *   - 桌面端经 client manifest 接口比对 version/sha256, 按需从【其绑定云控端】拉取本地副本
 *
 * 遵守 Migration 铁律: 仅 Schema::/DB:: 原生 API, 不 import 业务 Model; 已发布后只增不改。
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('deck_resource_assets', function (Blueprint $table) {
            $table->bigIncrements('id');
            // 资源类型: ffmpeg | template (未来可扩 tts_voice / model 权重)
            $table->string('kind', 20)->index();
            // ffmpeg: 'ffmpeg' / 'ffprobe'; template: 模板 id
            $table->string('asset_key', 120);
            // win-x64 | mac-x64 | mac-arm64 | any(模板平台无关)
            $table->string('platform', 20)->default('any');
            $table->string('version', 40)->default('');
            // 上游母 CDN 源地址(人工上传到 your-cdn-domain.example.com/{ffmpeg,pptdemo}/)
            $table->string('source_url', 1000)->default('');
            // 首次拉取自算并固化的 SHA256(桌面端强校验依据)
            $table->char('sha256', 64)->default('');
            $table->unsignedBigInteger('size')->default(0);
            // 云控端本地落盘相对路径(public/updates/... 由 Nginx 对外服务)
            $table->string('local_path', 1000)->default('');
            // pending(待拉取) | ready(可下发) | failed
            $table->string('status', 20)->default('pending');
            $table->string('error', 500)->default('');
            // OEM 渠道隔离(空=通用; 桌面端按 X-OEM-Project-Key 过滤可见集)
            $table->string('oem_project_key', 80)->default('');
            // 模板元数据(name/category/description/schema)等; ffmpeg 可空
            $table->json('meta')->nullable();
            $table->timestamps();

            $table->unique(
                ['kind', 'asset_key', 'platform', 'version', 'oem_project_key'],
                'deck_resource_assets_unique'
            );
            $table->index(['kind', 'platform', 'status'], 'deck_resource_assets_kind_plat_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('deck_resource_assets');
    }
};
