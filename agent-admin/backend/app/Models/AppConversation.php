<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AppConversation extends Model
{
    protected $table = 'app_conversations';

    protected $fillable = [
        'user_id', 'title', 'model', 'cloud_model_id', 'pinned',
    ];

    protected $casts = [
        'pinned' => 'boolean',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function cloudModel()
    {
        return $this->belongsTo(CloudModel::class);
    }

    public function messages()
    {
        return $this->hasMany(AppMessage::class, 'conversation_id');
    }
}
