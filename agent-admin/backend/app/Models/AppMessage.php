<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AppMessage extends Model
{
    protected $table = 'app_messages';

    protected $fillable = [
        'conversation_id', 'user_id', 'role', 'content', 'model', 'request_id',
    ];

    public function conversation()
    {
        return $this->belongsTo(AppConversation::class, 'conversation_id');
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
