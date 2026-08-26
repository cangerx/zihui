<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        Schema::create('billing_rules', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('cloud_model_id');
            $table->string('target_type', 20)->default('default');
            $table->unsignedBigInteger('target_id')->default(0);
            $table->enum('billing_type', ['token', 'credit'])->default('token');
            $table->decimal('input_price', 16, 8)->default(0);
            $table->decimal('output_price', 16, 8)->default(0);
            $table->decimal('credit_per_call', 10, 4)->default(0);
            $table->timestamps();

            $table->foreign('cloud_model_id')->references('id')->on('cloud_models')->onDelete('cascade');
            $table->unique(['cloud_model_id', 'target_type', 'target_id'], 'billing_rule_unique');
        });
    }

    public function down()
    {
        Schema::dropIfExists('billing_rules');
    }
};
