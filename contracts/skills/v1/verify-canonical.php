<?php

declare(strict_types=1);

function canonicalize(mixed $value): string
{
    if (is_array($value)) {
        if (array_is_list($value)) {
            return '[' . implode(',', array_map('canonicalize', $value)) . ']';
        }
        ksort($value, SORT_STRING);
        $pairs = [];
        foreach ($value as $key => $item) {
            $pairs[] = json_encode((string) $key, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)
                . ':' . canonicalize($item);
        }
        return '{' . implode(',', $pairs) . '}';
    }
    return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
}

$root = __DIR__;
$fixture = json_decode(file_get_contents($root . '/signature-payload.fixture.json'), true, 512, JSON_THROW_ON_ERROR);
$canonical = canonicalize($fixture);
$sha256 = hash('sha256', $canonical);
$expected = preg_split('/\\R/', trim(file_get_contents($root . '/signature-payload.expected.txt')));

if ($canonical !== $expected[0] || $sha256 !== $expected[1]) {
    fwrite(STDERR, "canonical fixture mismatch\ncanonical={$canonical}\nsha256={$sha256}\n");
    exit(1);
}
fwrite(STDOUT, "SKILL_CONTRACT_CANONICAL_OK {$sha256}\n");

