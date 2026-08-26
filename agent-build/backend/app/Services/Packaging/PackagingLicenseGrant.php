<?php

namespace App\Services\Packaging;

use Illuminate\Support\Facades\DB;

class PackagingLicenseGrant
{
    /**
     * @param string[] $features
     */
    public function grant(string $clientId, array $features): void
    {
        $update = ['updated_at' => now()];
        if (in_array(PackagingLicenseQuote::FEATURE_WIN, $features, true)) {
            $update['can_use_github_packaging'] = true;
        }
        if (in_array(PackagingLicenseQuote::FEATURE_MAC, $features, true)) {
            $update['can_use_mac_packaging'] = true;
        }
        if (count($update) === 1) {
            return;
        }
        DB::table('authorized_clients')->where('client_id', $clientId)->update($update);
    }

    /**
     * @return array{can_use_github_packaging:bool,can_use_mac_packaging:bool}
     */
    public function flags(object $client): array
    {
        return [
            'can_use_github_packaging' => (bool) ($client->can_use_github_packaging ?? false),
            'can_use_mac_packaging' => (bool) ($client->can_use_mac_packaging ?? false),
        ];
    }
}
