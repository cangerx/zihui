<?php

$root = dirname(__DIR__);
require $root . '/app/Services/SkillRegistry/SkillCanonical.php';
require $root . '/app/Services/SkillRegistry/SkillManifestValidator.php';
require $root . '/app/Services/SkillRegistry/SkillPackageScanner.php';
require $root . '/app/Services/SkillRegistry/SkillSignatureService.php';

use App\Services\SkillRegistry\SkillCanonical;
use App\Services\SkillRegistry\SkillPackageScanner;
use App\Services\SkillRegistry\SkillSignatureService;

$contract = dirname(__DIR__, 3) . '/contracts/skills/v1';
$fixture = json_decode(file_get_contents($contract . '/signature-payload.fixture.json'), true, 512, JSON_THROW_ON_ERROR);
$canonical = SkillCanonical::payload($fixture);
$expected = preg_split('/\R/', trim(file_get_contents($contract . '/signature-payload.expected.txt')));
if ($canonical !== $expected[0]) {
    fwrite(STDERR, "canonical mismatch\n");
    exit(1);
}

$skillId = '11111111-1111-4111-8111-111111111111';
$versionId = '22222222-2222-4222-8222-222222222222';
$manifest = [
    'schema_version' => 1,
    'skill_id' => $skillId,
    'version_id' => $versionId,
    'slug' => 'demo-skill',
    'name' => 'Demo',
    'version' => '1.2.3',
    'entrypoint' => 'SKILL.md',
    'files' => ['SKILL.md', 'skill.json'],
    'permissions' => [
        'filesystem' => 'none',
        'network' => ['domains' => []],
        'commands' => [],
        'mcp_servers' => [],
        'external_programs' => [],
    ],
    'minimum_client_version' => '1.2.0',
];

function writeZip(string $path, array $files): void
{
    $zip = new ZipArchive();
    $zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
    foreach ($files as $name => $body) {
        $zip->addFromString($name, $body);
    }
    $zip->close();
}

$dir = sys_get_temp_dir() . '/skill-scan-' . bin2hex(random_bytes(4));
mkdir($dir);
$okZip = $dir . '/ok.zip';
writeZip($okZip, [
    'skill.json' => json_encode($manifest, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
    'SKILL.md' => "# Demo\n",
]);
$scanner = new SkillPackageScanner();
$ok = $scanner->scan($okZip);
if (!$ok['ok'] || strlen((string) $ok['sha256']) !== 64) {
    fwrite(STDERR, "valid zip rejected\n");
    exit(1);
}

$bad = $dir . '/traverse.zip';
writeZip($bad, [
    'skill.json' => json_encode($manifest, JSON_UNESCAPED_SLASHES),
    'SKILL.md' => "# Demo\n",
    '../evil.txt' => 'x',
]);
$trav = $scanner->scan($bad);
if ($trav['ok'] || $trav['error'] !== 'package_unsafe') {
    fwrite(STDERR, "traversal not blocked\n");
    exit(1);
}

$many = $dir . '/many.zip';
$files = [
    'skill.json' => json_encode($manifest, JSON_UNESCAPED_SLASHES),
    'SKILL.md' => "# Demo\n",
];
for ($i = 0; $i < 90; $i++) {
    $files['f' . $i . '.txt'] = 'x';
}
writeZip($many, $files);
$tooMany = $scanner->scan($many);
if ($tooMany['ok']) {
    fwrite(STDERR, "file cap not enforced\n");
    exit(1);
}

$bomb = $dir . '/bomb.zip';
writeZip($bomb, [
    'skill.json' => json_encode($manifest, JSON_UNESCAPED_SLASHES),
    'SKILL.md' => "# Demo\n",
    'zeros.bin' => str_repeat("\0", 21_000_000),
]);
$bombed = $scanner->scan($bomb);
if ($bombed['ok']) {
    fwrite(STDERR, "zip bomb not blocked\n");
    exit(1);
}

$kp = sodium_crypto_sign_keypair();
$secret = sodium_crypto_sign_secretkey($kp);
$public = sodium_crypto_sign_publickey($kp);
$oldKp = sodium_crypto_sign_keypair();
$oldSecret = sodium_crypto_sign_secretkey($oldKp);
$oldPublic = sodium_crypto_sign_publickey($oldKp);

$current = new SkillSignatureService('registry-2026-01', $secret, $public, 'registry-2025-01', $oldPublic);
$signed = $current->sign([
    'skill_id' => $skillId,
    'version_id' => $versionId,
    'version' => '1.2.3',
    'sha256' => $ok['sha256'],
    'published_at' => '2026-08-22T08:00:00Z',
]);
if (!$current->verify($signed['payload'], $signed['signature'], 'registry-2026-01')) {
    fwrite(STDERR, "current verify failed\n");
    exit(1);
}
$tampered = hash('sha256', $ok['sha256'] . 'x');
$badPayload = SkillCanonical::payload([
    'key_id' => 'registry-2026-01',
    'manifest_schema_version' => 1,
    'published_at' => '2026-08-22T08:00:00Z',
    'sha256' => $tampered,
    'signature_algorithm' => 'ed25519',
    'skill_id' => $skillId,
    'version' => '1.2.3',
    'version_id' => $versionId,
]);
if ($current->verify($badPayload, $signed['signature'], 'registry-2026-01')) {
    fwrite(STDERR, "tamper accepted\n");
    exit(1);
}

$oldSigner = new SkillSignatureService('registry-2025-01', $oldSecret, $oldPublic);
$oldSigned = $oldSigner->sign([
    'skill_id' => $skillId,
    'version_id' => $versionId,
    'version' => '1.0.0',
    'sha256' => $ok['sha256'],
    'published_at' => '2026-01-01T00:00:00Z',
]);
if (!$current->verify($oldSigned['payload'], $oldSigned['signature'], 'registry-2025-01')) {
    fwrite(STDERR, "old key window failed\n");
    exit(1);
}

if (str_contains($signed['payload'], base64_encode($secret)) || str_contains(json_encode($ok), $secret)) {
    fwrite(STDERR, "secret leaked\n");
    exit(1);
}

foreach (glob($dir . '/*') as $file) {
    @unlink($file);
}
@rmdir($dir);

echo "SKILL_PACKAGE_SCAN_OK\n";
