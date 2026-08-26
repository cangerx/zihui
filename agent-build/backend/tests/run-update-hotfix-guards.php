<?php

$root = dirname(__DIR__);
$admin = file_get_contents($root . '/routes/admin.php');
$web = file_get_contents($root . '/routes/web.php');
$version = file_get_contents($root . '/config/version.php');
$example = file_get_contents($root . '/.env.example');

if (strpos($admin, 'use App\\Http\\Controllers\\Admin\\SkillRegistryController;') === false) {
    fwrite(STDERR, "SkillRegistryController import missing\n");
    exit(1);
}
if (strpos($admin, 'use App\\Http\\Controllers\\UpdateController;') === false) {
    fwrite(STDERR, "UpdateController import missing\n");
    exit(1);
}
if (strpos($admin, "UpdateController::class, 'current'") === false) {
    fwrite(STDERR, "updates/current route missing\n");
    exit(1);
}
if (strpos($web, "0.1.0-alpha") !== false) {
    fwrite(STDERR, "health route still hardcodes 0.1.0-alpha\n");
    exit(1);
}
if (strpos($web, "config('version.version')") === false) {
    fwrite(STDERR, "health route does not read config version\n");
    exit(1);
}
if (!preg_match("/'version'\\s*=>\\s*'0\\.19\\.1'/", $version)) {
    fwrite(STDERR, "version.php is not 0.19.1\n");
    exit(1);
}
if (strpos($version, '暂未实现后台在线更新 UI') !== false) {
    fwrite(STDERR, "stale version.php comment remains\n");
    exit(1);
}
if (strpos($example, 'UPDATE_CHECK_URL=') === false || strpos($example, 'UPDATE_RELEASES_URL=') === false) {
    fwrite(STDERR, ".env.example missing update URLs\n");
    exit(1);
}
$tsx = file_get_contents($root . '/../frontend/src/pages/Updates.tsx');
if ($tsx === false || strpos($tsx, 'loadLocalInfo') === false || strpos($tsx, 'updateApi.current') === false) {
    fwrite(STDERR, "Updates page does not load local current version\n");
    exit(1);
}
if (strpos($tsx, 'checkData?.current || localInfo?.version') === false) {
    fwrite(STDERR, "Updates page still blanks current version when check fails\n");
    exit(1);
}

echo "UPDATE_HOTFIX_GUARDS_OK\n";
