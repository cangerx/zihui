<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PlanModelAssignment extends Model
{
    protected $fillable = ['plan_id', 'cloud_model_id'];

    public function plan()
    {
        return $this->belongsTo(Plan::class);
    }

    public function cloudModel()
    {
        return $this->belongsTo(CloudModel::class, 'cloud_model_id');
    }
}
