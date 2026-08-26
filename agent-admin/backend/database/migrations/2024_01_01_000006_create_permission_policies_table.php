<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        Schema::create('permission_policies', function (Blueprint $table) {
            $table->id();
            $table->string('target_type', 20);
            $table->unsignedBigInteger('target_id');
            $table->string('policy_key', 100);
            $table->text('policy_value');
            $table->timestamps();

            $table->unique(['target_type', 'target_id', 'policy_key'], 'perm_policy_unique');
            $table->index(['target_type', 'target_id']);
        });
    }

    public function down()
    {
        Schema::dropIfExists('permission_policies');
    }
};
