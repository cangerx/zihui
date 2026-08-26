<?php

$checkUrl = (string) env('UPDATE_CHECK_URL', 'https://your-cdn-domain.example.com/buildup/version.json');
$releasesUrl = (string) env('UPDATE_RELEASES_URL', 'https://your-cdn-domain.example.com/buildup/releases.json');
$extraHosts = array_filter(array_map('trim', explode(',', (string) env('UPDATE_ALLOWED_ZIP_HOSTS', ''))));

return [
    /*
    |--------------------------------------------------------------------------
    | 当前授权管理端（agent-build）版本号（每次发布更新包必须修改）
    |--------------------------------------------------------------------------
    | 格式：MAJOR.MINOR.PATCH（语义化版本）
    | 读取：config('version.version')
    */
    'version' => '0.19.2',
    'released_at' => '2026-08-24',
    'name' => 'Agent Build',

    /*
    |--------------------------------------------------------------------------
    | 远端在线更新源（后台「在线更新」读取）
    |--------------------------------------------------------------------------
    | 生产必须在 .env 填写真实 CDN。默认占位域名无法解析，检查更新会失败。
    | 授权端路径是 /buildup/，不要写成云控的 /adminup/。
    | check_url / releases_url 的主机自动进入 zip 下载白名单。
    | 额外主机用 UPDATE_ALLOWED_ZIP_HOSTS（逗号分隔）。
    */
    'check_url' => $checkUrl,
    'releases_url' => $releasesUrl,
    'allowed_zip_hosts' => array_values(array_unique(array_filter(array_merge(
        [
            parse_url($checkUrl, PHP_URL_HOST),
            parse_url($releasesUrl, PHP_URL_HOST),
        ],
        $extraHosts
    )))),
    'http_timeout' => 30,
    'download_timeout' => 600,

    /*
    |--------------------------------------------------------------------------
    | 升级备份保留策略
    |--------------------------------------------------------------------------
    */
    'backup_keep_count' => (int) env('UPDATE_BACKUP_KEEP_COUNT', 5),
];
