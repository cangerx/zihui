<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            return;
        }
        if (!Schema::hasTable('video_sku_prices')) {
            return;
        }

        DB::table('video_sku_prices')
            ->where('model_id', 'grok-video')
            ->where('resolution', '720p')
            ->whereIn('duration_seconds', [6, 10])
            ->update([
                'provider_cost_text' => '¥0.28/次（多米 Apifox：GROK duration 6/10）',
                'provider_cost_source' => 'https://s.apifox.cn/b924931e-29c0-4127-b025-d68c90285060/api-427255838.md',
                'updated_at' => now(),
            ]);

        DB::table('video_sku_prices')
            ->where('model_id', 'grok-video')
            ->where('resolution', '720p')
            ->whereIn('duration_seconds', [15, 20])
            ->update([
                'provider_cost_text' => '¥0.56/次（多米 Apifox：GROK duration 15/20）',
                'provider_cost_source' => 'https://s.apifox.cn/b924931e-29c0-4127-b025-d68c90285060/api-427255838.md',
                'updated_at' => now(),
            ]);

        DB::table('video_sku_prices')
            ->where('model_id', 'grok-video')
            ->where('resolution', '720p')
            ->whereIn('duration_seconds', [25, 30])
            ->update([
                'provider_cost_text' => '¥0.84/次（多米 Apifox：GROK duration 25/30）',
                'provider_cost_source' => 'https://s.apifox.cn/b924931e-29c0-4127-b025-d68c90285060/api-427255838.md',
                'updated_at' => now(),
            ]);

        DB::table('video_sku_prices')
            ->where('sku_key', 'duomi:grok-video:default')
            ->update([
                'status' => 'disabled',
                'default_credit_cost' => null,
                'price_label' => '',
                'provider_cost_text' => '',
                'provider_cost_source' => 'https://s.apifox.cn/b924931e-29c0-4127-b025-d68c90285060/api-427255838.md',
                'updated_at' => now(),
            ]);

        DB::table('video_sku_prices')
            ->whereIn('model_id', ['veo3.1-fast', 'veo3.1-pro'])
            ->where('mode', 'image_to_video')
            ->where('aspect_ratio', '9:16')
            ->update([
                'status' => 'disabled',
                'default_credit_cost' => null,
                'price_label' => '',
                'updated_at' => now(),
            ]);
    }

    public function down(): void
    {
        if (!Schema::hasTable('video_sku_prices')) {
            return;
        }

        DB::table('video_sku_prices')
            ->where('model_id', 'grok-video')
            ->where('resolution', '720p')
            ->whereIn('duration_seconds', [6, 10])
            ->update([
                'provider_cost_text' => '¥0.28/次（参考成本，以多米控制台为准）',
                'provider_cost_source' => 'https://duomiapi.com/doc/98',
                'updated_at' => now(),
            ]);

        DB::table('video_sku_prices')
            ->where('model_id', 'grok-video')
            ->where('resolution', '720p')
            ->whereIn('duration_seconds', [15, 20])
            ->update([
                'provider_cost_text' => '¥0.56/次（参考成本，以多米控制台为准）',
                'provider_cost_source' => 'https://duomiapi.com/doc/98',
                'updated_at' => now(),
            ]);

        DB::table('video_sku_prices')
            ->where('model_id', 'grok-video')
            ->where('resolution', '720p')
            ->whereIn('duration_seconds', [25, 30])
            ->update([
                'provider_cost_text' => '¥0.84/次（参考成本，以多米控制台为准）',
                'provider_cost_source' => 'https://duomiapi.com/doc/98',
                'updated_at' => now(),
            ]);

        DB::table('video_sku_prices')
            ->whereIn('model_id', ['veo3.1-fast', 'veo3.1-pro'])
            ->where('mode', 'image_to_video')
            ->where('aspect_ratio', '9:16')
            ->update([
                'status' => 'active',
                'updated_at' => now(),
            ]);
    }
};
