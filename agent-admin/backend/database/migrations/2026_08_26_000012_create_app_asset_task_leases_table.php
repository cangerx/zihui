<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        if (Schema::hasTable('app_asset_task_leases')) return;
        Schema::create('app_asset_task_leases', function (Blueprint $table) {
            $table->id();
            $table->uuid('asset_id');
            $table->string('task_id', 36);
            $table->timestamp('lease_until');
            $table->timestamp('released_at')->nullable();
            $table->timestamps();
            $table->foreign('asset_id')->references('id')->on('app_assets')->onDelete('cascade');
            $table->index(['asset_id', 'lease_until', 'released_at']);
            $table->unique(['asset_id', 'task_id']);
        });
    }

    public function down()
    {
        Schema::dropIfExists('app_asset_task_leases');
    }
};
