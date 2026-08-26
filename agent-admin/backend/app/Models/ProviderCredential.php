<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * 服务商凭证池：一个 provider 可挂多把 API Key，由 GatewayRouter 按策略选用。
 *
 * 与 cloud_providers.api_key 字段并存：池子里 status=active 的行存在时优先使用，
 * 池子为空时回落 provider.api_key（保证老 provider 零行为变化）。
 *
 * 字段语义见 migration 注释（2026_05_09_100002_create_cloud_provider_credentials_table.php）。
 */
class ProviderCredential extends Model
{
    use SoftDeletes;

    protected $table = 'cloud_provider_credentials';

    protected $fillable = [
        'provider_id',
        'name',
        'api_key',
        'weight',
        'status',
        'fail_count',
        'last_used_at',
        'last_failed_at',
        'last_error',
        'remark',
    ];

    protected $hidden = ['api_key'];

    protected $casts = [
        'last_used_at'   => 'datetime',
        'last_failed_at' => 'datetime',
        'weight'         => 'integer',
        'fail_count'     => 'integer',
    ];

    public function provider()
    {
        return $this->belongsTo(CloudProvider::class, 'provider_id');
    }
}
