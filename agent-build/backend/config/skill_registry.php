<?php

return [
    'key_id' => env('SKILL_REGISTRY_KEY_ID', ''),
    'ed25519_secret' => env('SKILL_REGISTRY_ED25519_SECRET', ''),
    'ed25519_public' => env('SKILL_REGISTRY_ED25519_PUBLIC', ''),
    'old_key_id' => env('SKILL_REGISTRY_OLD_KEY_ID', ''),
    'ed25519_old_public' => env('SKILL_REGISTRY_ED25519_OLD_PUBLIC', ''),
    'sync_token' => env('SKILL_REGISTRY_SYNC_TOKEN', ''),
    'ticket_secret' => env('SKILL_REGISTRY_TICKET_SECRET', ''),
    'download_ttl' => (int) env('SKILL_REGISTRY_TICKET_TTL', 300),
];
