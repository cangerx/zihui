<?php

namespace App\Services\SkillCatalog;

class SkillSignatureService
{
    public function __construct(
        private string $keyId = '',
        private string $secretKey = '',
        private string $publicKey = '',
        private string $oldKeyId = '',
        private string $oldPublicKey = '',
    ) {
        if ($this->keyId === '') {
            $this->keyId = (string) (getenv('SKILL_REGISTRY_KEY_ID') ?: '');
        }
        if ($this->secretKey === '') {
            $this->secretKey = self::decodeKey((string) (getenv('SKILL_REGISTRY_ED25519_SECRET') ?: ''));
        }
        if ($this->publicKey === '') {
            $this->publicKey = self::decodeKey((string) (getenv('SKILL_REGISTRY_ED25519_PUBLIC') ?: ''));
        }
        if ($this->oldKeyId === '') {
            $this->oldKeyId = (string) (getenv('SKILL_REGISTRY_OLD_KEY_ID') ?: '');
        }
        if ($this->oldPublicKey === '') {
            $this->oldPublicKey = self::decodeKey((string) (getenv('SKILL_REGISTRY_ED25519_OLD_PUBLIC') ?: ''));
        }
    }

    public function keyId(): string
    {
        return $this->keyId;
    }

    /**
     * @param array<string, mixed> $fields
     * @return array{payload:string,signature:string,key_id:string,algorithm:string}
     */
    public function sign(array $fields): array
    {
        if (strlen($this->secretKey) !== SODIUM_CRYPTO_SIGN_SECRETKEYBYTES) {
            throw new \RuntimeException('skill_signing_key_missing');
        }
        $fields['signature_algorithm'] = 'ed25519';
        $fields['key_id'] = $this->keyId;
        $fields['manifest_schema_version'] = 1;
        $payload = SkillCanonical::payload($fields);
        $signature = sodium_crypto_sign_detached($payload, $this->secretKey);
        return [
            'payload' => $payload,
            'signature' => base64_encode($signature),
            'key_id' => $this->keyId,
            'algorithm' => 'ed25519',
        ];
    }

    public function verify(string $payload, string $signatureB64, string $keyId): bool
    {
        $sig = base64_decode($signatureB64, true);
        if ($sig === false || strlen($sig) !== SODIUM_CRYPTO_SIGN_BYTES) {
            return false;
        }
        $public = $this->publicFor($keyId);
        if ($public === null) {
            return false;
        }
        return sodium_crypto_sign_verify_detached($sig, $payload, $public);
    }

    public function publicFor(string $keyId): ?string
    {
        if ($keyId !== '' && $keyId === $this->keyId && strlen($this->publicKey) === SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES) {
            return $this->publicKey;
        }
        if ($keyId !== '' && $keyId === $this->oldKeyId && strlen($this->oldPublicKey) === SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES) {
            return $this->oldPublicKey;
        }
        return null;
    }

    /**
     * @return list<array{key_id:string,public_key:string}>
     */
    public function publicKeys(): array
    {
        $out = [];
        if ($this->keyId !== '' && strlen($this->publicKey) === SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES) {
            $out[] = ['key_id' => $this->keyId, 'public_key' => base64_encode($this->publicKey)];
        }
        if ($this->oldKeyId !== '' && strlen($this->oldPublicKey) === SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES) {
            $out[] = ['key_id' => $this->oldKeyId, 'public_key' => base64_encode($this->oldPublicKey)];
        }
        return $out;
    }

    public static function decodeKey(string $value): string
    {
        $value = trim($value);
        if ($value === '') {
            return '';
        }
        $decoded = base64_decode($value, true);
        return $decoded === false ? $value : $decoded;
    }
}
