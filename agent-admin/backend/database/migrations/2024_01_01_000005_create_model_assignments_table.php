<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        Schema::create('model_assignments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('cloud_model_id');
            $table->string('assignee_type', 20);
            $table->unsignedBigInteger('assignee_id');
            $table->timestamps();

            $table->foreign('cloud_model_id')->references('id')->on('cloud_models')->onDelete('cascade');
            $table->unique(['cloud_model_id', 'assignee_type', 'assignee_id'], 'model_assign_unique');
            $table->index(['assignee_type', 'assignee_id']);
        });
    }

    public function down()
    {
        Schema::dropIfExists('model_assignments');
    }
};
