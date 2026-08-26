<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * AI Deck 解说 TTS：供应商配置(key 留云控端, 服务端代理) + 合成产物记录(计费/缓存)。
 *   - tts_providers     : 三档(豆包预设 / OpenAI 兼容 / 通用模板), api_key 服务端持有不下发
 *   - tts_audio_assets  : 每次合成的产物登记(对象存储 URL + 字符数, 供按字符计费与即拉即用清理)
 *
 * 遵守 Migration 铁律: 仅 Schema::/DB:: 原生 API, 不 import 业务 Model。
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tts_providers', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('name', 100);
            // doubao | openai_compatible | generic
            $table->string('preset_type', 30)->default('doubao');
            $table->string('endpoint', 1000)->default('');
            // 服务端持有, 永不下发桌面端(输出层 mask)
            $table->text('api_key')->nullable();
            // 通用模板档: 鉴权 {type:header|bearer|query, headerName, valueTemplate}
            $table->json('auth')->nullable();
            // 自定义透传头
            $table->json('headers')->nullable();
            // 请求体模板(占位 {text}{voice}{speed}{format}{uuid})
            $table->text('body_template')->nullable();
            // binary | json-base64 | json-url(核心开关)
            $table->string('response_type', 20)->default('binary');
            // json-* 时取音频的路径(如 'data' / 'data.audio')
            $table->string('audio_path', 200)->default('');
            // mp3 | wav | pcm
            $table->string('format', 10)->default('mp3');
            $table->string('voice_default', 120)->default('');
            $table->decimal('speed_default', 4, 2)->default(1.0);
            // 豆包: cluster/voice_id 等; 其它扩展配置
            $table->json('config')->nullable();
            $table->string('status', 20)->default('active'); // active | disabled
            // 自动熔断
            $table->timestamp('suspended_at')->nullable();
            $table->string('suspended_reason', 500)->default('');
            $table->timestamps();

            $table->index(['status', 'preset_type'], 'tts_providers_status_idx');
        });

        Schema::create('tts_audio_assets', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('user_id')->default(0);
            $table->unsignedBigInteger('provider_id')->default(0);
            $table->char('text_hash', 64)->default(''); // sha256(text+voice+speed) 缓存键
            $table->unsignedInteger('char_count')->default(0); // 按字符计费依据
            $table->string('voice', 120)->default('');
            $table->string('format', 10)->default('mp3');
            $table->string('storage_url', 1000)->default('');
            $table->unsignedBigInteger('size')->default(0);
            $table->string('status', 20)->default('ready'); // ready | failed
            $table->string('error', 500)->default('');
            $table->timestamps();

            $table->index(['user_id', 'created_at'], 'tts_audio_user_idx');
            $table->index('text_hash', 'tts_audio_hash_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tts_audio_assets');
        Schema::dropIfExists('tts_providers');
    }
};
