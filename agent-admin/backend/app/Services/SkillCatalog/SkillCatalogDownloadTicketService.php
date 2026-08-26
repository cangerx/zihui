<?php

namespace App\Services\SkillCatalog;

class SkillCatalogDownloadTicketService
{
    public function __construct(
        private string $secret = '',
        private int $ttl = 0,
        private string $baseUrl = '',
    ) {
        if ($this->secret === '') {
            $this->secret = $this->envOrConfig('skill_catalog.ticket_secret', 'SKILL_CATALOG_TICKET_SECRET');
        }
        if ($this->baseUrl === '') {
            $this->baseUrl = rtrim($this->envOrConfig('skill_catalog.download_base', 'SKILL_CATALOG_DOWNLOAD_BASE', '/api/client/skills/download'), '/');
        }
        if ($this->ttl <= 0) {
            $ttl = (int) $this->envOrConfig('skill_catalog.ticket_ttl', 'SKILL_CATALOG_TICKET_TTL', '300');
            $this->ttl = $ttl > 0 ? $ttl : 300;
        }
    }

    private function envOrConfig(string $configKey, string $envKey, string $default = ''): string
    {
        try {
            $value = config($configKey);
            if ($value !== null && $value !== '') {
                return (string) $value;
            }
        } catch (\Throwable $e) {
        }
        $env = getenv($envKey);
        return $env !== false && $env !== '' ? (string) $env : $default;
    }

    /**
     * @return array{url:string,expires_at:string,sha256:string,signature:string,signature_algorithm:string,key_id:string}|null
     */
    public function issue(string $versionId, string $sha256, string $signature, string $keyId): ?array
    {
        if ($this->secret === '') {
            return null;
        }
        $exp = time() + $this->ttl;
        $mac = hash_hmac('sha256', $versionId . $exp . $sha256, $this->secret);
        $token = rtrim(strtr(base64_encode(json_encode([
            'vid' => $versionId,
            'exp' => $exp,
            'sha' => $sha256,
            'sig' => $mac,
        ], JSON_UNESCAPED_SLASHES)), '+/', '-_'), '=');
        return [
            'url' => $this->baseUrl . '/' . $token,
            'expires_at' => gmdate('c', $exp),
            'sha256' => $sha256,
            'signature' => $signature,
            'signature_algorithm' => 'ed25519',
            'key_id' => $keyId,
        ];
    }

    /**
     * @return array{version_id:string,sha256:string}|null
     */
    public function verify(string $token): ?array
    {
        if ($this->secret === '' || $token === '') {
            return null;
        }
        $pad = 4 - (strlen($token) % 4);
        if ($pad < 4) {
            $token .= str_repeat('=', $pad);
        }
        $decoded = base64_decode(strtr($token, '-_', '+/'), true);
        $data = is_string($decoded) ? json_decode($decoded, true) : null;
        if (!is_array($data) || !isset($data['vid'], $data['exp'], $data['sha'], $data['sig'])) {
            return null;
        }
        if ((int) $data['exp'] < time()) {
            return null;
        }
        $expected = hash_hmac('sha256', $data['vid'] . $data['exp'] . $data['sha'], $this->secret);
        if (!hash_equals($expected, (string) $data['sig'])) {
            return null;
        }
        return ['version_id' => (string) $data['vid'], 'sha256' => (string) $data['sha']];
    }
}
