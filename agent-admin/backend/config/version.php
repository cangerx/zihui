<?php

$authBase = rtrim((string) (env('AGENT_BUILD_BASE_URL') ?: (env('AGENT_BUILD_BASE_URL') ?: 'https://your-build-domain.example.com')), '/');
$checkUrl = env('UPDATE_CHECK_URL') ?: ($authBase . '/api/updates/admin/version.json');
$releasesUrl = env('UPDATE_RELEASES_URL') ?: ($authBase . '/api/updates/admin/releases.json');
$zipHosts = array_values(array_unique(array_filter(array_merge(
    ['your-cdn-domain.example.com'],
    array_filter([
        parse_url($checkUrl, PHP_URL_HOST),
        parse_url($releasesUrl, PHP_URL_HOST),
        parse_url($authBase, PHP_URL_HOST),
    ], fn ($h) => is_string($h) && $h !== ''),
    preg_split('/[\s,]+/', (string) env('UPDATE_ALLOWED_ZIP_HOSTS', '')) ?: []
))));

return [
    /*
    |--------------------------------------------------------------------------
    | 当前云控端版本号（每次发布更新包必须修改）
    |--------------------------------------------------------------------------
    | 格式：MAJOR.MINOR.PATCH（语义化版本）
    | 读取：config('version.version')
    */
    'version' => '1.6.43',
    'released_at' => '2026-08-24',
    'name' => 'Agent Admin',

    /*
    |--------------------------------------------------------------------------
    | 远端在线更新源
    |--------------------------------------------------------------------------
    | 未配 UPDATE_CHECK_URL 时指向授权端发版接口。
    | 白名单自动并入检查地址、授权端与 UPDATE_ALLOWED_ZIP_HOSTS（后续 COS 域名写这里）。
    */
    'check_url' => $checkUrl,
    'releases_url' => $releasesUrl,
    'allowed_zip_hosts' => $zipHosts,
    'http_timeout' => 30,
    'download_timeout' => 600,
    'backup_keep_count' => (int) env('UPDATE_BACKUP_KEEP_COUNT', 5),

    /*
    |--------------------------------------------------------------------------
    | 升级备份保留策略
    |--------------------------------------------------------------------------
    | 每次升级会在 storage/app/backups/{Y-m-d-His}/ 下生成 code.zip + database.sql。
    | UpdateService::pruneOldBackups 在 phaseBackup 末尾按字典序保留最近 N 份，
    | 超出部分递归删除。底线 1 份（防止误配置 0 删干净）。
    | 改值后立即生效，下一次升级即按新值清理。
    */
];
