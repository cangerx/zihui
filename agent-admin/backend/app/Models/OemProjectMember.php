<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class OemProjectMember extends Model
{
    protected $fillable = [
        'oem_project_key',
        'user_id',
        'role',
        'status',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
