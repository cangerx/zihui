<?php

$admin = file_get_contents(__DIR__ . '/../routes/admin.php');
$api = file_get_contents(__DIR__ . '/../routes/api.php');
if (strpos($admin, "middleware('auth:sanctum')") === false) {
    fwrite(STDERR, "admin not gated\n");
    exit(1);
}
if (strpos($admin, "skill-registry/pending") === false || strpos($admin, 'SkillRegistryController') === false) {
    fwrite(STDERR, "admin skills missing\n");
    exit(1);
}
if (strpos($admin, 'use App\\Http\\Controllers\\UpdateController;') === false) {
    fwrite(STDERR, "UpdateController import missing\n");
    exit(1);
}
if (strpos($api, "prefix('skills/v1')") === false) {
    fwrite(STDERR, "public skills missing\n");
    exit(1);
}
if (strpos($api, 'skill_registry_sync') === false) {
    fwrite(STDERR, "sync gate missing\n");
    exit(1);
}
$kernel = file_get_contents(__DIR__ . '/../app/Http/Kernel.php');
if (strpos($kernel, 'VerifySkillRegistrySync') === false) {
    fwrite(STDERR, "middleware missing\n");
    exit(1);
}
echo "SKILL_REGISTRY_API_OK\n";
