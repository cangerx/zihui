<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('video_provider_accounts')) {
            DB::table('video_provider_accounts')->where('provider_key', 'mock')->delete();
        }

        if (Schema::hasTable('video_pricing_rules') && Schema::hasTable('video_sku_prices')) {
            DB::table('video_pricing_rules')
                ->whereIn('video_sku_price_id', function ($query) {
                    $query->select('id')->from('video_sku_prices')->where('provider_key', 'mock');
                })
                ->delete();
        }

        if (Schema::hasTable('video_sku_prices')) {
            DB::table('video_sku_prices')->where('provider_key', 'mock')->delete();
        }

        if (Schema::hasTable('video_model_specs')) {
            $referencedIds = collect();

            if (Schema::hasTable('video_tasks')) {
                $referencedIds = $referencedIds->merge(
                    DB::table('video_tasks')
                        ->where('provider_key', 'mock')
                        ->whereNotNull('video_model_spec_id')
                        ->pluck('video_model_spec_id')
                );
            }

            if (Schema::hasTable('video_usage_records')) {
                $referencedIds = $referencedIds->merge(
                    DB::table('video_usage_records')
                        ->where('provider_key', 'mock')
                        ->whereNotNull('video_model_spec_id')
                        ->pluck('video_model_spec_id')
                );
            }

            $referencedIds = $referencedIds->map(fn ($id) => (int) $id)->unique()->values()->all();

            $query = DB::table('video_model_specs')->where('provider_key', 'mock');
            if (!empty($referencedIds)) {
                $query->whereNotIn('id', $referencedIds);
            }
            $query->delete();

            if (!empty($referencedIds)) {
                DB::table('video_model_specs')
                    ->where('provider_key', 'mock')
                    ->whereIn('id', $referencedIds)
                    ->update(['status' => 'disabled', 'updated_at' => now()]);
            }
        }
    }

    public function down(): void
    {
    }
};
