<?php

$root = dirname(__DIR__);
require $root . '/app/Services/SkillRegistry/SkillStateMachine.php';
require $root . '/app/Services/SkillRegistry/SkillDownloadTicketService.php';
require $root . '/app/Services/SkillRegistry/SkillCanonical.php';

use App\Services\SkillRegistry\SkillDownloadTicketService;
use App\Services\SkillRegistry\SkillStateMachine;

$m = new SkillStateMachine();
assert($m->canVersion('pending_review', 'published'));
assert($m->canVersion('published', 'revoked'));
assert(!$m->canVersion('revoked', 'published'));
try {
    $m->assertVersion('revoked', 'published');
    fwrite(STDERR, "revoked resurrected\n");
    exit(1);
} catch (InvalidArgumentException $e) {
}

$tickets = new SkillDownloadTicketService('ticket-secret-for-tests', 60, '/api/skills/v1/download');
$issued = $tickets->issue('22222222-2222-4222-8222-222222222222', str_repeat('a', 64), 'sig', 'registry-test');
if ($issued === null || strpos($issued['url'], '/api/skills/v1/download/') === false) {
    fwrite(STDERR, "ticket issue failed\n");
    exit(1);
}
$token = basename($issued['url']);
$parsed = $tickets->verify($token);
if ($parsed === null || $parsed['version_id'] !== '22222222-2222-4222-8222-222222222222') {
    fwrite(STDERR, "ticket verify failed\n");
    exit(1);
}
if ($tickets->verify('not-a-token') !== null) {
    fwrite(STDERR, "bogus ticket accepted\n");
    exit(1);
}

$svc = file_get_contents($root . '/app/Services/SkillRegistry/SkillRegistryService.php');
foreach (['version_published', 'version_revoked', 'package_path', 'cursor_gap'] as $needle) {
    if (strpos($svc, $needle) === false) {
        fwrite(STDERR, "registry service missing {$needle}\n");
        exit(1);
    }
}
if (strpos($svc, "\$version->package_path !== \$path") === false) {
    fwrite(STDERR, "revoke does not guard package path\n");
    exit(1);
}

$admin = file_get_contents($root . '/app/Http/Controllers/Admin/SkillRegistryController.php');
if (strpos($admin, 'function review') === false || strpos($admin, 'function revoke') === false) {
    fwrite(STDERR, "admin controller missing review/revoke\n");
    exit(1);
}

echo "SKILL_REGISTRY_LOOP_OK\n";
