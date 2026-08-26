<?php

return [
    'registry_base_url' => env('SKILL_REGISTRY_BASE_URL', ''),
    'sync_token' => env('SKILL_REGISTRY_SYNC_TOKEN', ''),
    'ticket_secret' => env('SKILL_CATALOG_TICKET_SECRET', ''),
    'ticket_ttl' => (int) env('SKILL_CATALOG_TICKET_TTL', 300),
    'download_base' => env('SKILL_CATALOG_DOWNLOAD_BASE') ?: '/api/client/skills/download',
    'key_id' => env('SKILL_REGISTRY_KEY_ID', ''),
    'ed25519_public' => env('SKILL_REGISTRY_ED25519_PUBLIC', ''),
    'old_key_id' => env('SKILL_REGISTRY_OLD_KEY_ID', ''),
    'ed25519_old_public' => env('SKILL_REGISTRY_ED25519_OLD_PUBLIC', ''),
];
