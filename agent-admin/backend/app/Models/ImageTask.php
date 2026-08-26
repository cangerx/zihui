<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ImageTask extends Model
{
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'id', 'user_id', 'cloud_model_id', 'endpoint',
        'request_body', 'status', 'result', 'error',
        'cost', 'request_id',
    ];

    protected $casts = [
        'request_body' => 'array',
        'result' => 'array',
        'cost' => 'float',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function cloudModel()
    {
        return $this->belongsTo(CloudModel::class);
    }
}
