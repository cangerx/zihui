<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CloudProvider extends Model
{
    protected $fillable = [
        'name', 'type', 'api_base', 'api_key', 'status', 'remark',
        'last_test_at', 'last_test_status', 'last_test_kind', 'last_test_message',
        // 多协议适配器架构（task 1 migration 引入）
        'config', 'capabilities', 'suspended_at', 'suspended_reason',
    ];

    protected $hidden = ['api_key'];

    protected $casts = [
        'last_test_at'   => 'datetime',
        // JSON 字段自动序列化/反序列化为数组，避免 Service / Adapter 重复 json_decode
        'config'         => 'array',
        'capabilities'   => 'array',
        'suspended_at'   => 'datetime',
    ];

    public function models()
    {
        return $this->hasMany(CloudModel::class, 'provider_id');
    }

    /**
     * 凭证池关联：一个 provider 可挂多把 API Key（GatewayRouter 按策略调度）。
     * 池子为空时回落到 self::api_key 字段。
     */
    public function credentials()
    {
        return $this->hasMany(ProviderCredential::class, 'provider_id');
    }
}
