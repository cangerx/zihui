<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * 全员开放「自定义模型服务商」(allow_custom_provider)。
 *
 * - 全局默认已改为 true（QuotaService）
 * - 本迁移把已有套餐 / 用户·分组权限策略中的该键统一为 true，避免旧 false 覆盖默认
 */
return new class extends Migration
{
    public function up(): void
    {
        $now = now();
        $trueJson = json_encode(true, JSON_UNESCAPED_UNICODE);

        if (Schema::hasTable('plan_permissions')) {
            DB::table('plan_permissions')
                ->where('policy_key', 'allow_custom_provider')
                ->update(['policy_value' => $trueJson]);

            if (Schema::hasTable('plans')) {
                $planIds = DB::table('plans')->pluck('id');
                foreach ($planIds as $planId) {
                    $exists = DB::table('plan_permissions')
                        ->where('plan_id', $planId)
                        ->where('policy_key', 'allow_custom_provider')
                        ->exists();
                    if ($exists) {
                        continue;
                    }
                    DB::table('plan_permissions')->insert([
                        'plan_id' => $planId,
                        'policy_key' => 'allow_custom_provider',
                        'policy_value' => $trueJson,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]);
                }
            }
        }

        if (Schema::hasTable('permission_policies')) {
            DB::table('permission_policies')
                ->where('policy_key', 'allow_custom_provider')
                ->update(['policy_value' => $trueJson]);
        }
    }

    public function down(): void
    {
        // 不自动回滚为 false：避免误关线上用户 BYOK
    }
};
