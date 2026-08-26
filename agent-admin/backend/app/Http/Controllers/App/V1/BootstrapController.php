<?php

namespace App\Http\Controllers\App\V1;

use App\Support\AppV1Response;
use Illuminate\Http\Request;

class BootstrapController
{
    public function __invoke(Request $request)
    {
        $channel = (string) $request->header('X-Channel', 'web');
        if (!in_array($channel, ['desktop', 'web', 'h5', 'mini_program'], true)) {
            $channel = 'web';
        }

        return AppV1Response::ok([
            'api_version' => 'v1',
            'channel' => $channel,
            'brand' => [
                'name' => (string) config('app_v1.brand.name', 'Zihui AI'),
                'description' => (string) config('app_v1.brand.description', '智能创作平台'),
                'favicon' => null,
            ],
            'auth' => [
                'password' => true,
                'email_code' => (bool) config('app_v1.auth.email_code', false),
                'phone_sms' => (bool) config('app_v1.auth.phone_sms', false),
                'wechat_mini' => $channel === 'mini_program'
                    && (bool) config('app_v1.auth.wechat_mini', false),
            ],
            'features' => collect(config('app_v1.features', []))
                ->map(fn ($enabled, $name) => [
                    'enabled' => (bool) $enabled,
                    'requires_auth' => !in_array($name, ['discovery', 'billing'], true),
                ])->all(),
        ]);
    }
}
