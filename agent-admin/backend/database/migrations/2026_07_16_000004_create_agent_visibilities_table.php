<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 智能体定向可见白名单：仅当 agents.visibility_scope = restricted 时生效。
        // 仿 model_assignments：assignee_type = user / group，命中即可见。
        Schema::create('agent_visibilities', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('agent_id');
            $table->string('assignee_type', 20); // user / group
            $table->unsignedBigInteger('assignee_id');
            $table->timestamps();

            $table->unique(['agent_id', 'assignee_type', 'assignee_id'], 'agent_vis_unique');
            $table->index(['assignee_type', 'assignee_id']);

            $table->foreign('agent_id')->references('id')->on('agents')->onDelete('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('agent_visibilities');
    }
};
