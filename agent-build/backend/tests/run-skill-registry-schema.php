<?php

require dirname(__DIR__) . '/app/Services/SkillRegistry/SkillStateMachine.php';

use App\Services\SkillRegistry\SkillStateMachine;

$m = new SkillStateMachine();
assert($m->canSkill('draft', 'active'));
assert(!$m->canSkill('retired', 'active'));
assert($m->canVersion('uploaded', 'scanning'));
assert($m->canVersion('pending_review', 'published'));
assert($m->canVersion('published', 'revoked'));
assert(!$m->canVersion('published', 'uploaded'));
assert(!$m->canVersion('revoked', 'published'));
try {
    $m->assertVersion('published', 'pending_review');
    fwrite(STDERR, "published mutate allowed\n");
    exit(1);
} catch (InvalidArgumentException $e) {
    // expected
}

$migration = file_get_contents(dirname(__DIR__) . '/database/migrations/2026_08_22_000100_create_skill_registry_tables.php');
foreach ([
    'skill_registry_skills',
    'skill_registry_versions',
    'skill_registry_reviews',
    'skill_registry_reports',
    'skill_registry_events',
    "char('skill_id', 36)->unique()",
    "char('version_id', 36)->unique()",
    "unique(['skill_id', 'version']",
    "bigIncrements('id')",
] as $needle) {
    if (strpos($migration, $needle) === false) {
        fwrite(STDERR, "migration missing {$needle}\n");
        exit(1);
    }
}

echo "SKILL_REGISTRY_SCHEMA_OK\n";
