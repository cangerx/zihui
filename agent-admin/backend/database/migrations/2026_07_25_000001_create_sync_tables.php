<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 云同步与容量计费核心表。
 *   - sync_records : 每用户结构化变更中心（server_seq 单调游标 + payload 快照）
 *   - sync_blobs   : 内容寻址媒体元数据（per-user 去重，引用计数）
 *   - sync_devices : 设备登记（多设备同步状态展示）
 *   - user_storage : 用户已用容量（gauge，配额声明式计算不入此表）
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sync_records', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('user_id');
            $table->unsignedBigInteger('server_seq'); // 该用户内单调自增（核心增量游标）
            $table->string('entity', 40);
            $table->string('sync_uid', 64);
            $table->unsignedInteger('rev')->default(1);
            $table->boolean('deleted')->default(false);
            $table->char('content_hash', 64)->default('');
            $table->unsignedBigInteger('updated_ms')->default(0);
            $table->string('origin_device', 64)->default('');
            $table->longText('payload')->nullable(); // deleted=1 时为 NULL
            $table->timestamps();

            $table->unique(['user_id', 'entity', 'sync_uid'], 'sync_records_uid_unique');
            $table->unique(['user_id', 'server_seq'], 'sync_records_seq_unique');
            $table->index(['user_id', 'server_seq'], 'sync_records_user_seq_idx');
        });

        Schema::create('sync_blobs', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('user_id');
            $table->char('sha256', 64);
            $table->unsignedBigInteger('size')->default(0);
            $table->string('category', 20)->default('image'); // image | video | data
            $table->string('storage_driver', 20)->default('local'); // local | cos | oss
            $table->string('storage_url', 1000)->default('');
            $table->unsignedInteger('ref_count')->default(0);
            $table->string('status', 20)->default('pending'); // pending | committed
            $table->timestamps();

            $table->unique(['user_id', 'sha256'], 'sync_blobs_user_sha_unique');
            $table->index(['user_id', 'status'], 'sync_blobs_user_status_idx');
        });

        Schema::create('sync_devices', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('user_id');
            $table->string('device_id', 64);
            $table->string('name', 100)->default('');
            $table->unsignedBigInteger('last_seq')->default(0);
            $table->timestamp('last_sync_at')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'device_id'], 'sync_devices_user_device_unique');
        });

        Schema::create('user_storage', function (Blueprint $table) {
            $table->unsignedBigInteger('user_id')->primary();
            $table->unsignedBigInteger('used_bytes')->default(0);
            $table->timestamp('updated_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_storage');
        Schema::dropIfExists('sync_devices');
        Schema::dropIfExists('sync_blobs');
        Schema::dropIfExists('sync_records');
    }
};
