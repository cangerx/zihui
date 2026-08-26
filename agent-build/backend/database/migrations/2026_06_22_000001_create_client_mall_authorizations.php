<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * 「店铺商品图」一级授权泛化 v2：从单布尔 can_use_ewei_shop 改为「按商城」关联表。
 *
 * 背景：以后还会接入更多第三方商城（先支持 ewei / dianda），单布尔无法扩展，
 * 故新建关联表 client_mall_authorizations，每行 = (某云控端, 某商城) 的一级授权位。
 *
 * 死契约：mall_key 取值严格为字符串 'ewei' / 'dianda'（三端统一约定，任一端不一致权限即失效）。
 *
 * 铁律（在线更新依赖）：
 *  - 不修改 / 不删除已发布的 2026_06_20_000001 与旧列 can_use_ewei_shop（保留只读，向后兼容）。
 *  - 本 migration 只用 Schema:: / DB:: 原生 API，不 import 任何业务 Model。
 *  - up() 内回填：把 authorized_clients 中 can_use_ewei_shop=1 的行写入 (client_id,'ewei',true)，避免存量掉权。
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('client_mall_authorizations')) {
            Schema::create('client_mall_authorizations', function (Blueprint $table) {
                $table->bigIncrements('id');
                // 关联 authorized_clients.client_id（字符串主键，如 client_xxxxxxxx）
                $table->string('client_id', 64);
                // 商城标识，死契约枚举：'ewei' / 'dianda'（以后扩展只在应用层加白名单）
                $table->string('mall_key', 32);
                // 一级授权位：true=该云控端对该商城开放「店铺商品图」
                $table->boolean('authorized')->default(false);
                $table->timestamps();

                // 一个客户端对一个商城只有一条授权行
                $table->unique(['client_id', 'mall_key'], 'uniq_client_mall');
                // 按 client 聚合查询（index() 列表）/ 按 mall_key 过滤
                $table->index('client_id', 'idx_cma_client_id');
                $table->index('mall_key', 'idx_cma_mall_key');
            });
        }

        // 回填：存量 can_use_ewei_shop=1 的客户端 → (client_id,'ewei',true)，避免掉权。
        // 仅当旧列存在时回填（极端情况下旧 migration 未跑也不致命）。
        if (Schema::hasColumn('authorized_clients', 'can_use_ewei_shop')) {
            $now = now();
            DB::table('authorized_clients')
                ->where('can_use_ewei_shop', 1)
                ->select('client_id')
                ->orderBy('client_id')
                ->chunk(500, function ($rows) use ($now) {
                    $payload = [];
                    foreach ($rows as $row) {
                        $payload[] = [
                            'client_id' => $row->client_id,
                            'mall_key' => 'ewei',
                            'authorized' => true,
                            'created_at' => $now,
                            'updated_at' => $now,
                        ];
                    }
                    if (!empty($payload)) {
                        // insertOrIgnore：避免重复跑 / 唯一索引冲突时报错（幂等）
                        DB::table('client_mall_authorizations')->insertOrIgnore($payload);
                    }
                });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('client_mall_authorizations');
    }
};
