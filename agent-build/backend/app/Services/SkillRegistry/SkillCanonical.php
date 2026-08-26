<?php

namespace App\Services\SkillRegistry;

/**
 * 与 contracts/skills/v1/verify-canonical.php 同源的 compact JSON。
 */
class SkillCanonical
{
    public static function encode(mixed $value): string
    {
        if (is_array($value)) {
            if (array_is_list($value)) {
                return '[' . implode(',', array_map([self::class, 'encode'], $value)) . ']';
            }
            ksort($value, SORT_STRING);
            $pairs = [];
            foreach ($value as $key => $item) {
                $pairs[] = json_encode((string) $key, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)
                    . ':' . self::encode($item);
            }
            return '{' . implode(',', $pairs) . '}';
        }
        return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    /**
     * @param array<string, mixed> $payload
     */
    public static function payload(array $payload): string
    {
        $required = [
            'key_id', 'manifest_schema_version', 'published_at', 'sha256',
            'signature_algorithm', 'skill_id', 'version', 'version_id',
        ];
        $out = [];
        foreach ($required as $key) {
            if (!array_key_exists($key, $payload)) {
                throw new \InvalidArgumentException('signature_payload_incomplete');
            }
            $out[$key] = $payload[$key];
        }
        return self::encode($out);
    }
}
