<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('video_sku_prices') || !Schema::hasTable('video_model_specs')) {
            return;
        }

        DB::transaction(function () {
            $this->deleteUnsupportedSkus();

            DB::table('video_model_specs')
                ->where('provider_key', 'duomi')
                ->where('model_id', 'doubao-seedance-2-0-fast-260128')
                ->update([
                    'supported_resolutions' => json_encode(['720p'], JSON_UNESCAPED_UNICODE),
                    'updated_at' => now(),
                ]);

            DB::table('video_model_specs')
                ->where('provider_key', 'duomi')
                ->whereIn('model_id', ['veo3.1-fast', 'veo3.1-pro'])
                ->update([
                    'max_reference_images' => 3,
                    'updated_at' => now(),
                ]);
        });
    }

    public function down(): void
    {
    }

    private function deleteUnsupportedSkus(): void
    {
        $ids = DB::table('video_sku_prices')
            ->where('provider_key', 'duomi')
            ->where(function ($query) {
                $query->where(function ($q) {
                    $q->where('model_id', 'doubao-seedance-2-0-fast-260128')
                        ->where('resolution', '1080p');
                })->orWhere(function ($q) {
                    $q->whereIn('model_id', ['veo3.1-fast', 'veo3.1-pro'])
                        ->where('mode', 'image_to_video')
                        ->where('aspect_ratio', '9:16');
                })->orWhere('sku_key', 'duomi:grok-video:default');
            })
            ->pluck('id')
            ->map(fn($id) => (int)$id)
            ->values()
            ->all();

        if (empty($ids)) {
            return;
        }

        if (Schema::hasTable('video_tasks')) {
            DB::table('video_tasks')->whereIn('video_sku_price_id', $ids)->update(['video_sku_price_id' => null]);
        }
        if (Schema::hasTable('video_usage_records')) {
            DB::table('video_usage_records')->whereIn('video_sku_price_id', $ids)->update(['video_sku_price_id' => null]);
        }
        if (Schema::hasTable('video_pricing_rules')) {
            DB::table('video_pricing_rules')->whereIn('video_sku_price_id', $ids)->delete();
        }

        DB::table('video_sku_prices')->whereIn('id', $ids)->delete();
    }
};
