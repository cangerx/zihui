<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('video_provider_accounts')) {
        Schema::create('video_provider_accounts', function (Blueprint $table) {
            $table->id();
            $table->string('provider_key', 50)->default('duomi');
            $table->string('name', 100);
            $table->string('base_url', 500)->default('https://duomiapi.com');
            $table->text('api_key')->nullable();
            $table->string('auth_style', 50)->default('raw_authorization_header');
            $table->string('status', 20)->default('active');
            $table->json('config')->nullable();
            $table->timestamp('last_test_at')->nullable();
            $table->string('last_test_status', 20)->nullable();
            $table->string('last_test_message', 500)->default('');
            $table->string('remark', 500)->default('');
            $table->timestamps();

            $table->index(['provider_key', 'status']);
            $table->unique(['provider_key', 'name']);
        });
        }

        if (!Schema::hasTable('video_model_specs')) {
        Schema::create('video_model_specs', function (Blueprint $table) {
            $table->id();
            $table->string('provider_key', 50)->default('duomi');
            $table->string('provider_protocol', 50);
            $table->string('model_id', 150);
            $table->string('display_name', 150);
            $table->string('generation_type', 50)->default('text_to_video');
            $table->string('status', 20)->default('active');
            $table->json('supported_modes')->nullable();
            $table->json('supported_durations')->nullable();
            $table->json('supported_resolutions')->nullable();
            $table->json('supported_aspect_ratios')->nullable();
            $table->unsignedInteger('max_reference_images')->default(0);
            $table->json('provider_params')->nullable();
            $table->string('description', 500)->default('');
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();

            $table->unique(['provider_key', 'model_id']);
            $table->index(['provider_key', 'provider_protocol', 'status'], 'vms_provider_status_idx');
        });
        }

        if (!Schema::hasTable('video_sku_prices')) {
        Schema::create('video_sku_prices', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('video_model_spec_id');
            $table->string('sku_key', 200)->unique();
            $table->string('provider_key', 50)->default('duomi');
            $table->string('provider_protocol', 50);
            $table->string('model_id', 150);
            $table->string('title', 200);
            $table->string('mode', 50)->default('');
            $table->unsignedInteger('duration_seconds')->default(0);
            $table->string('resolution', 50)->default('');
            $table->string('aspect_ratio', 50)->default('');
            $table->string('quality', 50)->default('');
            $table->decimal('default_credit_cost', 16, 6)->default(0);
            $table->string('price_label', 100)->default('');
            $table->string('provider_cost_text', 300)->default('');
            $table->string('provider_cost_source', 500)->default('');
            $table->json('provider_params')->nullable();
            $table->string('status', 20)->default('active');
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();

            $table->foreign('video_model_spec_id')->references('id')->on('video_model_specs')->onDelete('cascade');
            $table->index(['provider_key', 'provider_protocol', 'status'], 'vsp_provider_status_idx');
            $table->index(['video_model_spec_id', 'status']);
        });
        }

        if (!Schema::hasTable('video_pricing_rules')) {
        Schema::create('video_pricing_rules', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('video_sku_price_id');
            $table->string('target_type', 20)->default('default');
            $table->unsignedBigInteger('target_id')->default(0);
            $table->decimal('credit_cost', 16, 6)->default(0);
            $table->string('status', 20)->default('active');
            $table->string('remark', 500)->default('');
            $table->timestamps();

            $table->foreign('video_sku_price_id')->references('id')->on('video_sku_prices')->onDelete('cascade');
            $table->unique(['video_sku_price_id', 'target_type', 'target_id'], 'video_pricing_rule_unique');
            $table->index(['target_type', 'target_id', 'status']);
        });
        }

        if (!Schema::hasTable('video_tasks')) {
        Schema::create('video_tasks', function (Blueprint $table) {
            $table->string('id', 36)->primary();
            $table->unsignedBigInteger('user_id')->index();
            $table->unsignedBigInteger('video_provider_account_id')->nullable();
            $table->unsignedBigInteger('video_model_spec_id');
            $table->unsignedBigInteger('video_sku_price_id')->nullable();
            $table->string('provider_key', 50)->default('duomi');
            $table->string('provider_protocol', 50);
            $table->string('model_id', 150);
            $table->string('sku_key', 200)->default('');
            $table->string('request_id', 36)->index();
            $table->string('provider_task_id', 200)->nullable()->index();
            $table->string('status', 30)->default('pending')->index();
            $table->string('provider_status', 80)->default('');
            $table->unsignedTinyInteger('progress')->default(0);
            $table->text('prompt')->nullable();
            $table->text('negative_prompt')->nullable();
            $table->json('input_assets')->nullable();
            $table->json('request_params')->nullable();
            $table->json('submit_payload')->nullable();
            $table->json('provider_response')->nullable();
            $table->json('billing_snapshot')->nullable();
            $table->string('billing_status', 30)->default('pending')->index();
            $table->decimal('estimated_credits', 16, 6)->default(0);
            $table->decimal('credits_used', 16, 6)->default(0);
            $table->string('error_code', 100)->default('');
            $table->text('error_message')->nullable();
            $table->timestamp('submitted_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('failed_at')->nullable();
            $table->timestamps();

            $table->foreign('video_provider_account_id')->references('id')->on('video_provider_accounts')->nullOnDelete();
            $table->foreign('video_model_spec_id')->references('id')->on('video_model_specs');
            $table->foreign('video_sku_price_id')->references('id')->on('video_sku_prices')->nullOnDelete();
            $table->index(['user_id', 'created_at']);
            $table->index(['provider_key', 'provider_protocol', 'status'], 'vt_provider_status_idx');
        });
        }

        if (!Schema::hasTable('video_results')) {
        Schema::create('video_results', function (Blueprint $table) {
            $table->id();
            $table->string('video_task_id', 36)->unique();
            $table->unsignedBigInteger('user_id')->index();
            $table->string('remote_url', 1000)->default('');
            $table->string('storage_url', 1000)->default('');
            $table->string('cover_url', 1000)->default('');
            $table->unsignedInteger('duration_seconds')->default(0);
            $table->unsignedInteger('width')->default(0);
            $table->unsignedInteger('height')->default(0);
            $table->string('mime_type', 100)->default('');
            $table->unsignedBigInteger('file_size')->default(0);
            $table->string('storage_status', 30)->default('remote_url_only');
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->foreign('video_task_id')->references('id')->on('video_tasks')->onDelete('cascade');
            $table->index(['user_id', 'created_at']);
        });
        }

        if (!Schema::hasTable('video_usage_records')) {
        Schema::create('video_usage_records', function (Blueprint $table) {
            $table->id();
            $table->string('video_task_id', 36)->unique();
            $table->unsignedBigInteger('user_id')->index();
            $table->unsignedBigInteger('video_model_spec_id');
            $table->unsignedBigInteger('video_sku_price_id')->nullable();
            $table->string('provider_key', 50)->default('duomi');
            $table->string('provider_protocol', 50);
            $table->string('model_id', 150);
            $table->string('sku_key', 200)->default('');
            $table->decimal('credits_used', 16, 6)->default(0);
            $table->string('balance_type', 20)->default('credit');
            $table->unsignedBigInteger('source_plan_id')->nullable();
            $table->string('status', 20)->default('success');
            $table->string('request_id', 36)->default('');
            $table->string('remark', 500)->default('');
            $table->json('billing_snapshot')->nullable();
            $table->timestamps();

            $table->foreign('video_task_id')->references('id')->on('video_tasks')->onDelete('cascade');
            $table->foreign('video_model_spec_id')->references('id')->on('video_model_specs');
            $table->foreign('video_sku_price_id')->references('id')->on('video_sku_prices')->nullOnDelete();
            $table->index(['user_id', 'created_at']);
            $table->index(['provider_key', 'provider_protocol', 'created_at'], 'vur_provider_created_idx');
            $table->index('status');
        });
        }

        $this->ensureIndex('video_usage_records', 'vur_provider_created_idx', ['provider_key', 'provider_protocol', 'created_at']);
        $this->ensureIndex('video_usage_records', 'video_usage_records_status_index', ['status']);

        if (!Schema::hasTable('temporary_reference_assets')) {
        Schema::create('temporary_reference_assets', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id')->index();
            $table->string('video_task_id', 36)->nullable()->index();
            $table->string('asset_type', 30)->default('image');
            $table->string('source', 30)->default('upload');
            $table->string('original_url', 1000)->default('');
            $table->string('storage_url', 1000)->default('');
            $table->string('mime_type', 100)->default('');
            $table->unsignedBigInteger('file_size')->default(0);
            $table->string('status', 20)->default('active');
            $table->timestamp('expires_at')->nullable()->index();
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->foreign('video_task_id')->references('id')->on('video_tasks')->nullOnDelete();
            $table->index(['user_id', 'status', 'expires_at']);
        });
        }

        $now = now();
        if (DB::table('video_model_specs')->count() === 0) {
        DB::table('video_model_specs')->insert([
            [
                'provider_key' => 'duomi',
                'provider_protocol' => 'seedance',
                'model_id' => 'doubao-seedance-2-0-260128',
                'display_name' => 'Seedance 2.0',
                'generation_type' => 'multimodal_video',
                'status' => 'active',
                'supported_modes' => json_encode(['standard'], JSON_UNESCAPED_UNICODE),
                'supported_durations' => json_encode([5, 10], JSON_UNESCAPED_UNICODE),
                'supported_resolutions' => json_encode(['720p', '1080p'], JSON_UNESCAPED_UNICODE),
                'supported_aspect_ratios' => json_encode(['16:9', '9:16', '1:1'], JSON_UNESCAPED_UNICODE),
                'max_reference_images' => 3,
                'provider_params' => json_encode(['doc_url' => 'https://duomiapi.com/doc/105', 'submit_path' => '/api/v3/contents/generations/tasks', 'query_path' => '/api/v3/contents/generations/tasks/{task_id}'], JSON_UNESCAPED_UNICODE),
                'description' => '多米 Seedance 2.0 官方格式，按秒计费。',
                'sort_order' => 10,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'provider_key' => 'duomi',
                'provider_protocol' => 'seedance',
                'model_id' => 'doubao-seedance-2-0-fast-260128',
                'display_name' => 'Seedance 2.0 Fast',
                'generation_type' => 'multimodal_video',
                'status' => 'active',
                'supported_modes' => json_encode(['fast'], JSON_UNESCAPED_UNICODE),
                'supported_durations' => json_encode([5, 10], JSON_UNESCAPED_UNICODE),
                'supported_resolutions' => json_encode(['720p', '1080p'], JSON_UNESCAPED_UNICODE),
                'supported_aspect_ratios' => json_encode(['16:9', '9:16', '1:1'], JSON_UNESCAPED_UNICODE),
                'max_reference_images' => 3,
                'provider_params' => json_encode(['doc_url' => 'https://duomiapi.com/doc/105', 'submit_path' => '/api/v3/contents/generations/tasks', 'query_path' => '/api/v3/contents/generations/tasks/{task_id}'], JSON_UNESCAPED_UNICODE),
                'description' => '多米 Seedance 2.0 Fast 官方格式，按秒计费。',
                'sort_order' => 20,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'provider_key' => 'duomi',
                'provider_protocol' => 'veo',
                'model_id' => 'veo3.1-fast',
                'display_name' => 'VEO 3.1 Fast',
                'generation_type' => 'text_or_image_to_video',
                'status' => 'active',
                'supported_modes' => json_encode(['text_to_video', 'image_to_video', 'first_last_frame'], JSON_UNESCAPED_UNICODE),
                'supported_durations' => json_encode([4, 8, 12], JSON_UNESCAPED_UNICODE),
                'supported_resolutions' => json_encode(['720p', '1080p', '4k'], JSON_UNESCAPED_UNICODE),
                'supported_aspect_ratios' => json_encode(['16:9', '9:16', '1:1'], JSON_UNESCAPED_UNICODE),
                'max_reference_images' => 2,
                'provider_params' => json_encode(['doc_url' => 'https://duomiapi.com/doc/98', 'submit_path' => '/v1/videos/generations', 'query_path' => '/v1/videos/tasks/{task_id}'], JSON_UNESCAPED_UNICODE),
                'description' => '多米 VEO 3.1 Fast 视频生成。',
                'sort_order' => 30,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'provider_key' => 'duomi',
                'provider_protocol' => 'veo',
                'model_id' => 'veo3.1-pro',
                'display_name' => 'VEO 3.1 Pro',
                'generation_type' => 'text_or_image_to_video',
                'status' => 'active',
                'supported_modes' => json_encode(['text_to_video', 'image_to_video', 'first_last_frame'], JSON_UNESCAPED_UNICODE),
                'supported_durations' => json_encode([4, 8, 12], JSON_UNESCAPED_UNICODE),
                'supported_resolutions' => json_encode(['720p', '1080p', '4k'], JSON_UNESCAPED_UNICODE),
                'supported_aspect_ratios' => json_encode(['16:9', '9:16', '1:1'], JSON_UNESCAPED_UNICODE),
                'max_reference_images' => 2,
                'provider_params' => json_encode(['doc_url' => 'https://duomiapi.com/doc/98', 'submit_path' => '/v1/videos/generations', 'query_path' => '/v1/videos/tasks/{task_id}'], JSON_UNESCAPED_UNICODE),
                'description' => '多米 VEO 3.1 Pro 视频生成。',
                'sort_order' => 40,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'provider_key' => 'duomi',
                'provider_protocol' => 'grok',
                'model_id' => 'grok-video',
                'display_name' => 'GROK Video',
                'generation_type' => 'text_or_image_to_video',
                'status' => 'active',
                'supported_modes' => json_encode(['text_to_video', 'image_to_video'], JSON_UNESCAPED_UNICODE),
                'supported_durations' => json_encode([4, 8, 12], JSON_UNESCAPED_UNICODE),
                'supported_resolutions' => json_encode(['720p', '1080p'], JSON_UNESCAPED_UNICODE),
                'supported_aspect_ratios' => json_encode(['16:9', '9:16', '1:1'], JSON_UNESCAPED_UNICODE),
                'max_reference_images' => 7,
                'provider_params' => json_encode(['doc_url' => 'https://duomiapi.com/doc/98', 'submit_path' => '/v1/videos/generations', 'query_path' => '/v1/videos/tasks/{task_id}'], JSON_UNESCAPED_UNICODE),
                'description' => '多米 GROK Video，价格以多米 Apifox/控制台为准。',
                'sort_order' => 50,
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ]);
        }

        if (DB::table('video_sku_prices')->count() === 0) {
        $specs = DB::table('video_model_specs')->where('provider_key', 'duomi')->pluck('id', 'model_id');
        $rows = [];
        $push = function (string $modelId, string $skuKey, string $title, string $protocol, string $mode, int $duration, string $resolution, string $aspectRatio, float $credits, string $costText, string $source, int $sort) use (&$rows, $specs, $now) {
            $rows[] = [
                'video_model_spec_id' => (int) $specs[$modelId],
                'sku_key' => $skuKey,
                'provider_key' => 'duomi',
                'provider_protocol' => $protocol,
                'model_id' => $modelId,
                'title' => $title,
                'mode' => $mode,
                'duration_seconds' => $duration,
                'resolution' => $resolution,
                'aspect_ratio' => $aspectRatio,
                'quality' => '',
                'default_credit_cost' => $credits,
                'price_label' => $credits > 0 ? rtrim(rtrim((string) $credits, '0'), '.') . ' 算力/次' : '后台配置',
                'provider_cost_text' => $costText,
                'provider_cost_source' => $source,
                'provider_params' => json_encode([], JSON_UNESCAPED_UNICODE),
                'status' => 'active',
                'sort_order' => $sort,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        };

        foreach (['doubao-seedance-2-0-260128' => 'Seedance 2.0', 'doubao-seedance-2-0-fast-260128' => 'Seedance 2.0 Fast'] as $modelId => $name) {
            foreach ([5, 10] as $duration) {
                $credits = $duration * 1.0;
                $push($modelId, 'duomi:' . $modelId . ':' . $duration . 's:standard', $name . ' ' . $duration . ' 秒', 'seedance', $modelId === 'doubao-seedance-2-0-fast-260128' ? 'fast' : 'standard', $duration, '1080p', '16:9', $credits, '多米 doc/105：1元/秒，价格同官方', 'https://duomiapi.com/doc/105', 100 + $duration);
            }
        }

        foreach (['veo3.1-fast' => ['720p' => 0.2, '1080p' => 0.4, '4k' => 0.5], 'veo3.1-pro' => ['720p' => 1.0, '1080p' => 1.2, '4k' => 1.5]] as $modelId => $prices) {
            foreach ($prices as $resolution => $credits) {
                $push($modelId, 'duomi:' . $modelId . ':' . $resolution, strtoupper($modelId) . ' ' . $resolution, 'veo', 'text_to_video', 8, $resolution, '16:9', $credits, '多米 doc/98：' . $modelId . ' ' . $resolution . ' ' . $credits . '元/次', 'https://duomiapi.com/doc/98', 200 + count($rows));
            }
        }

        $push('grok-video', 'duomi:grok-video:default', 'GROK Video 默认', 'grok', 'text_to_video', 8, '1080p', '16:9', 0.2, '多米 doc/98：GROK 价格以 Apifox/控制台为准', 'https://duomiapi.com/doc/98', 300);

        DB::table('video_sku_prices')->insert($rows);
        }

        if (DB::table('video_pricing_rules')->count() === 0) {
        $priceRules = [];
        foreach (DB::table('video_sku_prices')->get(['id', 'default_credit_cost']) as $sku) {
            $priceRules[] = [
                'video_sku_price_id' => (int) $sku->id,
                'target_type' => 'default',
                'target_id' => 0,
                'credit_cost' => (float) $sku->default_credit_cost,
                'status' => 'active',
                'remark' => '',
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }
        DB::table('video_pricing_rules')->insert($priceRules);
        }
    }

    private function ensureIndex(string $table, string $index, array $columns): void
    {
        if (!Schema::hasTable($table)) return;

        $exists = DB::table('information_schema.statistics')
            ->whereRaw('table_schema = DATABASE()')
            ->where('table_name', $table)
            ->where('index_name', $index)
            ->exists();

        if ($exists) return;

        Schema::table($table, function (Blueprint $table) use ($columns, $index) {
            $table->index($columns, $index);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('temporary_reference_assets');
        Schema::dropIfExists('video_usage_records');
        Schema::dropIfExists('video_results');
        Schema::dropIfExists('video_tasks');
        Schema::dropIfExists('video_pricing_rules');
        Schema::dropIfExists('video_sku_prices');
        Schema::dropIfExists('video_model_specs');
        Schema::dropIfExists('video_provider_accounts');
    }
};
