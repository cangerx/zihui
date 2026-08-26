<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ModelAssignment extends Model
{
    protected $fillable = [
        'cloud_model_id', 'assignee_type', 'assignee_id', 'source_plan_id',
    ];

    public function cloudModel()
    {
        return $this->belongsTo(CloudModel::class, 'cloud_model_id');
    }

    public function assignee()
    {
        return $this->morphTo();
    }
}
