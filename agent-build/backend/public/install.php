<?php
/**
 * agent-build 可视化安装向导
 *
 * 单文件部署：复制 backend/ 到服务器 → 浏览器访问 /install.php → 4 步向导
 *
 * 流程：
 *   1. 环境检测   PHP 版本 / 必装扩展 / 必启函数
 *   2. 权限检测   storage/ bootstrap/cache/ backend/ public/ 可写
 *   3. 数据库     PDO 连接测试，默认 127.0.0.1:3306
 *   4. 管理员     管理员账号密码 + GitHub Token（可选）
 *
 * 安装完成后写入 storage/installed.lock，再访问返回 404 防重装。
 *
 * 与 agent-admin 的差异：
 *   - admin_users 表（不是 users），字段 username/password_hash/name/role/is_active
 *   - 无 site_title（纯运维后台），APP_NAME 固定为 AgentBuild
 *   - 额外随机生成 BUILD_SIGN_SECRET
 *   - GITHUB_BUILD_TOKEN 选填（空则 dispatch 降级，不影响启动）
 *   - 创建 storage/app/build-artifacts 中转目录
 *   - 安装完强提示配 cron（否则 BuildWorker 不跑）
 *
 * 安全：
 *   - lock 存在 → 404
 *   - 不依赖 Laravel autoload，直到所有用户输入校验通过才 require vendor
 *   - 使用 PDO + prepared statement，杜绝 SQL 注入
 *   - 密码用 password_hash(PASSWORD_BCRYPT)，与 Laravel Hash::make 兼容
 */

declare(strict_types=1);

define('INSTALL_DIR', __DIR__);
define('BACKEND_DIR', dirname(__DIR__));
define('LOCK_FILE', BACKEND_DIR . '/storage/installed.lock');
define('ENV_FILE', BACKEND_DIR . '/.env');

// ---------- 已安装拦截 ----------
if (file_exists(LOCK_FILE)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Not Found';
    exit;
}

// ---------- API 路由 ----------
$action = $_GET['action'] ?? '';
if ($action !== '') {
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    try {
        $result = match ($action) {
            'check_env'   => action_check_env(),
            'check_perms' => action_check_perms(),
            'test_db'     => action_test_db(),
            'install'     => action_install(),
            default       => ['ok' => false, 'error' => 'unknown_action'],
        };
        echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    } catch (Throwable $e) {
        http_response_code(500);
        echo json_encode([
            'ok'    => false,
            'error' => 'install_exception',
            'msg'   => $e->getMessage(),
            'where' => $e->getFile() . ':' . $e->getLine(),
        ], JSON_UNESCAPED_UNICODE);
    }
    exit;
}

// ---------- ① 环境检测 ----------
function action_check_env(): array
{
    $checks = [];

    // PHP 版本（agent-build composer.json 要求 ^8.0.2）
    $phpOk = version_compare(PHP_VERSION, '8.0.2', '>=');
    $checks[] = [
        'name'     => 'PHP 版本',
        'required' => '>= 8.0.2',
        'actual'   => PHP_VERSION,
        'ok'       => $phpOk,
    ];

    // 必装扩展
    $exts = ['fileinfo', 'openssl', 'pdo_mysql', 'mbstring', 'tokenizer', 'xml', 'ctype', 'json', 'bcmath', 'curl'];
    foreach ($exts as $ext) {
        $loaded = extension_loaded($ext);
        $checks[] = [
            'name'     => 'PHP 扩展: ' . $ext,
            'required' => '已启用',
            'actual'   => $loaded ? '已启用' : '未启用',
            'ok'       => $loaded,
        ];
    }

    // 必启函数
    $disabled = array_map('trim', explode(',', (string) ini_get('disable_functions')));
    $needFns  = ['exec', 'popen', 'proc_open', 'putenv'];
    foreach ($needFns as $fn) {
        $isDisabled = in_array($fn, $disabled, true) || !function_exists($fn);
        $checks[] = [
            'name'     => 'PHP 函数: ' . $fn,
            'required' => '可用',
            'actual'   => $isDisabled ? '被禁用' : '可用',
            'ok'       => !$isDisabled,
        ];
    }

    return [
        'ok'     => array_reduce($checks, fn($acc, $c) => $acc && $c['ok'], true),
        'checks' => $checks,
    ];
}

// ---------- ② 文件权限检测 ----------
function action_check_perms(): array
{
    $paths = [
        BACKEND_DIR . '/storage'         => 'storage 目录（日志 + 产物中转）',
        BACKEND_DIR . '/bootstrap/cache' => 'bootstrap/cache 目录',
        BACKEND_DIR                      => 'backend 根目录（写 .env）',
        BACKEND_DIR . '/public'          => 'public 目录',
    ];

    $checks = [];
    foreach ($paths as $path => $name) {
        $exists   = is_dir($path);
        $writable = $exists && is_writable($path);
        $checks[] = [
            'name'     => $name,
            'path'     => $path,
            'required' => '存在且可写',
            'actual'   => !$exists ? '不存在' : ($writable ? '可写' : '不可写'),
            'ok'       => $writable,
        ];
    }

    // .env 如果已存在但不可写 → 阻塞
    if (file_exists(ENV_FILE)) {
        $envWritable = is_writable(ENV_FILE);
        $checks[] = [
            'name'     => '.env 文件（已存在）',
            'path'     => ENV_FILE,
            'required' => '可写（覆盖）',
            'actual'   => $envWritable ? '可写' : '不可写',
            'ok'       => $envWritable,
        ];
    }

    // vendor/autoload.php 必须存在（composer install 的产物）
    $vendorOk = file_exists(BACKEND_DIR . '/vendor/autoload.php');
    $checks[] = [
        'name'     => 'vendor/autoload.php（composer 产物）',
        'path'     => BACKEND_DIR . '/vendor/autoload.php',
        'required' => '存在',
        'actual'   => $vendorOk ? '存在' : '不存在，请先跑 composer install --no-dev',
        'ok'       => $vendorOk,
    ];

    return [
        'ok'     => array_reduce($checks, fn($acc, $c) => $acc && $c['ok'], true),
        'checks' => $checks,
    ];
}

// ---------- ③ 数据库连接测试 ----------
function action_test_db(): array
{
    $payload = read_json_input();

    $host = trim((string) ($payload['host']     ?? ''));
    $port = (int)         ($payload['port']     ?? 3306);
    $db   = trim((string) ($payload['database'] ?? ''));
    $user = trim((string) ($payload['username'] ?? ''));
    $pass = (string)      ($payload['password'] ?? '');

    if ($host === '' || $db === '' || $user === '') {
        return ['ok' => false, 'error' => '请填写完整的数据库信息（host / database / username）'];
    }

    try {
        $pdo = new PDO(
            "mysql:host=$host;port=$port;dbname=$db;charset=utf8mb4",
            $user,
            $pass,
            [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_TIMEOUT            => 5,
                PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4",
            ]
        );
        $version = (string) $pdo->query('SELECT VERSION()')->fetchColumn();
        $charsetRow = $pdo->query("SHOW VARIABLES LIKE 'character_set_database'")->fetch(PDO::FETCH_ASSOC);
        $charset = $charsetRow ? ($charsetRow['Value'] ?? '') : '';

        // utf8mb4 索引长度兼容：MySQL 5.7.7+ / 8.0+ / MariaDB 10.2+
        $isMariaDB = stripos($version, 'mariadb') !== false;
        $major = $minor = $patch = 0;
        if ($isMariaDB && preg_match('/(\d+)\.(\d+)\.(\d+)-MariaDB/i', $version, $vm)) {
            $major = (int)$vm[1]; $minor = (int)$vm[2]; $patch = (int)$vm[3];
        } elseif (preg_match('/^(\d+)\.(\d+)\.(\d+)/', $version, $vm)) {
            $major = (int)$vm[1]; $minor = (int)$vm[2]; $patch = (int)$vm[3];
        }

        $compatible = $isMariaDB
            ? (($major > 10) || ($major === 10 && $minor >= 2))
            : (($major >= 8) || ($major === 5 && $minor === 7 && $patch >= 7) || ($major === 5 && $minor > 7));

        if (!$compatible) {
            $hint = $isMariaDB
                ? "数据库版本 {$version} 不兼容：MariaDB 需要 10.2+ 才能支持 utf8mb4 长索引。"
                : "数据库版本 {$version} 不兼容：需要 MySQL 5.7.7+ 或 8.0+。"
                  . "请通过宝塔面板「软件商店 → MySQL → 切换版本」一键升级（数据自动保留），重启后重新进入向导。";
            return [
                'ok'    => false,
                'error' => $hint,
                'mysql_version'    => $version,
                'database_charset' => $charset,
            ];
        }

        $ilpWarn = '';
        $ilpRow = $pdo->query("SHOW VARIABLES LIKE 'innodb_large_prefix'")->fetch(PDO::FETCH_ASSOC);
        if ($ilpRow && isset($ilpRow['Value'])) {
            $val = strtoupper((string) $ilpRow['Value']);
            if ($val === 'OFF' || $val === '0') {
                $ilpWarn = 'innodb_large_prefix=OFF 被显式关闭，可能导致 migrate 索引超长报错。'
                    . '建议 my.cnf 改为 innodb_large_prefix=1 + innodb_default_row_format=dynamic 后重启 MySQL。';
            }
        }

        $charsetWarn = '';
        if ($charset !== '' && stripos($charset, 'utf8mb4') === false) {
            $charsetWarn = '当前数据库字符集 ' . $charset . '，建议改为 utf8mb4，避免中文 / emoji 数据异常。';
        }

        $warns = array_values(array_filter([$charsetWarn, $ilpWarn]));

        return [
            'ok'              => true,
            'mysql_version'   => $version,
            'database_charset' => $charset,
            'charset_warning' => implode('；', $warns),
        ];
    } catch (PDOException $e) {
        return [
            'ok'    => false,
            'error' => mb_substr($e->getMessage(), 0, 300),
        ];
    }
}

// ---------- ④ 执行安装 ----------
function action_install(): array
{
    $payload = read_json_input();

    $errors = [];

    $dbHost     = trim((string) ($payload['db_host']        ?? ''));
    $dbPort     = (int)         ($payload['db_port']        ?? 3306);
    $dbName     = trim((string) ($payload['db_database']    ?? ''));
    $dbUser     = trim((string) ($payload['db_username']    ?? ''));
    $dbPass     = (string)      ($payload['db_password']    ?? '');
    $adminUser  = trim((string) ($payload['admin_username'] ?? ''));
    $adminPass  = (string)      ($payload['admin_password'] ?? '');
    $adminName  = trim((string) ($payload['admin_name']     ?? ''));
    $githubToken = trim((string)($payload['github_token']   ?? ''));
    $githubRepo = trim((string) ($payload['github_repo']    ?? 'your-org/your-build-repo'));

    if ($dbHost === '' || $dbName === '' || $dbUser === '')   $errors[] = '数据库信息不完整';
    if ($adminUser === '' || strlen($adminUser) < 3)          $errors[] = '管理员用户名至少 3 个字符';
    if (!preg_match('/^[a-zA-Z0-9_]{3,50}$/', $adminUser))    $errors[] = '管理员用户名只能含字母、数字、下划线';
    if (strlen($adminPass) < 6)                               $errors[] = '管理员密码至少 6 个字符';
    if ($adminName !== '' && mb_strlen($adminName) > 50)      $errors[] = '显示名最长 50 字';
    if ($githubRepo !== '' && !preg_match('/^[\w.\-]+\/[\w.\-]+$/', $githubRepo)) {
        $errors[] = 'GitHub 仓库格式应为 owner/repo';
    }

    if ($errors) {
        return ['ok' => false, 'error' => implode('；', $errors)];
    }

    // 重新校验环境与权限（防绕过）
    $envCheck = action_check_env();
    if (!$envCheck['ok']) {
        return ['ok' => false, 'error' => '环境检测未通过，请先解决环境问题', 'env' => $envCheck];
    }
    $permCheck = action_check_perms();
    if (!$permCheck['ok']) {
        return ['ok' => false, 'error' => '权限检测未通过', 'perms' => $permCheck];
    }

    // 重连数据库
    try {
        $pdo = new PDO(
            "mysql:host=$dbHost;port=$dbPort;dbname=$dbName;charset=utf8mb4",
            $dbUser,
            $dbPass,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_TIMEOUT => 5,
            ]
        );
    } catch (PDOException $e) {
        return ['ok' => false, 'error' => '数据库连接失败：' . $e->getMessage()];
    }

    // 1. 写 .env
    $appUrl = detect_app_url();
    $appKey = 'base64:' . base64_encode(random_bytes(32));
    $signSecret   = bin2hex(random_bytes(32));

    $envContent = build_env_content([
        'APP_KEY'              => $appKey,
        'APP_URL'              => $appUrl,
        'DB_HOST'              => $dbHost,
        'DB_PORT'              => (string) $dbPort,
        'DB_DATABASE'          => $dbName,
        'DB_USERNAME'          => $dbUser,
        'DB_PASSWORD'          => $dbPass,
        'GITHUB_BUILD_TOKEN'   => $githubToken,
        'GITHUB_BUILD_REPO'    => $githubRepo,
        'BUILD_SIGN_SECRET'    => $signSecret,
        'BUILD_DOWNLOAD_BASE'  => rtrim($appUrl, '/') . '/dl',
    ]);

    if (file_put_contents(ENV_FILE, $envContent) === false) {
        return ['ok' => false, 'error' => '写入 .env 失败：' . ENV_FILE];
    }
    @chmod(ENV_FILE, 0644);

    // 2. 清 bootstrap/cache 静态缓存
    foreach (glob(BACKEND_DIR . '/bootstrap/cache/*.php') as $cached) {
        @unlink($cached);
    }

    // 3. Bootstrap Laravel + migrate
    if (!file_exists(BACKEND_DIR . '/vendor/autoload.php')) {
        return ['ok' => false, 'error' => 'vendor/autoload.php 不存在。请先在 backend/ 目录执行 composer install --no-dev'];
    }

    try {
        require_once BACKEND_DIR . '/vendor/autoload.php';
        /** @var \Illuminate\Foundation\Application $app */
        $app = require BACKEND_DIR . '/bootstrap/app.php';
        /** @var \Illuminate\Contracts\Console\Kernel $kernel */
        $kernel = $app->make(\Illuminate\Contracts\Console\Kernel::class);
        $kernel->bootstrap();

        \Illuminate\Support\Facades\Artisan::call('config:clear');

        $exit = \Illuminate\Support\Facades\Artisan::call('migrate', ['--force' => true]);
        $migrateOutput = \Illuminate\Support\Facades\Artisan::output();
        if ($exit !== 0) {
            return [
                'ok'     => false,
                'error'  => 'migrate 失败',
                'output' => $migrateOutput,
            ];
        }
    } catch (Throwable $e) {
        return [
            'ok'    => false,
            'error' => 'Laravel bootstrap 失败：' . $e->getMessage(),
            'where' => $e->getFile() . ':' . $e->getLine(),
        ];
    }

    // 4. 创建管理员（admin_users 表）
    //    重装场景：可能已存在同 username 的旧用户，先 DELETE 再 INSERT
    $now = date('Y-m-d H:i:s');
    $displayName = $adminName !== '' ? $adminName : $adminUser;
    try {
        $pdo->prepare('DELETE FROM admin_users WHERE username = ?')->execute([$adminUser]);
        $stmt = $pdo->prepare(
            'INSERT INTO admin_users (username, password_hash, name, role, is_active, created_at, updated_at)
             VALUES (?, ?, ?, "admin", 1, ?, ?)'
        );
        $stmt->execute([
            $adminUser,
            password_hash($adminPass, PASSWORD_BCRYPT),
            $displayName,
            $now,
            $now,
        ]);
    } catch (PDOException $e) {
        return ['ok' => false, 'error' => '创建管理员失败：' . $e->getMessage()];
    }

    // 5. 创建 artifact 中转目录
    $artifactDir = BACKEND_DIR . '/storage/app/build-artifacts';
    if (!is_dir($artifactDir)) {
        @mkdir($artifactDir, 0775, true);
    }

    // 6. 生成 cron 建议命令（用当前 PHP 路径）
    $phpBinary = PHP_BINARY ?: '/usr/bin/php';
    $cronLine  = sprintf(
        '* * * * * cd %s && %s artisan schedule:run >> /dev/null 2>&1',
        BACKEND_DIR,
        $phpBinary
    );

    // 7. 写 lock 文件
    $lock = json_encode([
        'installed_at'   => $now,
        'admin_username' => $adminUser,
        'app_url'        => $appUrl,
        'github_token_set'     => $githubToken !== '',
        'build_sign_secret_len'   => strlen($signSecret),
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if (file_put_contents(LOCK_FILE, (string) $lock) === false) {
        return ['ok' => false, 'error' => '写入锁文件失败：' . LOCK_FILE];
    }
    @chmod(LOCK_FILE, 0644);

    return [
        'ok'              => true,
        'message'         => '安装完成',
        'redirect'        => '/admin/',
        'admin_user'      => $adminUser,
        'github_token_set' => $githubToken !== '',
        'cron_line'       => $cronLine,
        'backend_dir'     => BACKEND_DIR,
    ];
}

// ---------- 工具函数 ----------
function read_json_input(): array
{
    $raw = file_get_contents('php://input');
    if (!is_string($raw) || $raw === '') return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function detect_app_url(): string
{
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO'])) {
        $scheme = strtolower((string) $_SERVER['HTTP_X_FORWARDED_PROTO']);
    }
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    return $scheme . '://' . $host;
}

function build_env_content(array $vars): string
{
    $template = <<<'ENV'
APP_NAME=AgentBuild
APP_ENV=production
APP_KEY={APP_KEY}
APP_DEBUG=false
APP_URL={APP_URL}

LOG_CHANNEL=stack
LOG_LEVEL=warning

DB_CONNECTION=mysql
DB_HOST={DB_HOST}
DB_PORT={DB_PORT}
DB_DATABASE={DB_DATABASE}
DB_USERNAME={DB_USERNAME}
DB_PASSWORD="{DB_PASSWORD}"

BROADCAST_DRIVER=log
CACHE_DRIVER=file
FILESYSTEM_DISK=local
QUEUE_CONNECTION=sync
SESSION_DRIVER=file
SESSION_LIFETIME=120

# ==== agent-build 核心 ====

# fine-grained PAT，权限：Actions: write 对 local-agent-build repo
# 留空时 dispatch 会降级（落库 queued 但不真触发 Actions），仅 dev 模式下用
GITHUB_BUILD_TOKEN={GITHUB_BUILD_TOKEN}
GITHUB_BUILD_REPO={GITHUB_BUILD_REPO}
GITHUB_WORKFLOW_WIN=build-win.yml
GITHUB_WORKFLOW_MAC=build-mac.yml
GITHUB_BUILD_REF=main

# 签名下载 URL HMAC 密钥（安装时随机生成，禁止手工修改，否则已发出的下载 URL 全部失效）
BUILD_SIGN_SECRET={BUILD_SIGN_SECRET}
BUILD_DOWNLOAD_BASE={BUILD_DOWNLOAD_BASE}
BUILD_DOWNLOAD_TTL=1800

# artifact 中转目录（相对 storage_path()）
BUILD_STORAGE_SUBDIR=app/build-artifacts
ENV;

    foreach ($vars as $key => $val) {
        $template = str_replace('{' . $key . '}', escape_env_value($key, (string) $val), $template);
    }
    return $template . "\n";
}

function escape_env_value(string $key, string $val): string
{
    // 只有 DB_PASSWORD 走双引号包裹（允许特殊字符）
    if ($key === 'DB_PASSWORD') {
        return str_replace(['\\', '"'], ['\\\\', '\\"'], $val);
    }
    return $val;
}

// ---------- HTML 渲染 ----------
?><!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>agent-build 安装向导</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: #f5f5f5;
    color: #1f1f1f;
    line-height: 1.5;
  }
  .wrap { max-width: 880px; margin: 32px auto; padding: 0 16px; }
  .card {
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    overflow: hidden;
  }
  .header { padding: 24px 32px; border-bottom: 1px solid #f0f0f0; }
  .header h1 { margin: 0 0 4px 0; font-size: 22px; font-weight: 600; }
  .header .sub { color: #8c8c8c; font-size: 13px; margin-bottom: 16px; }
  .steps { display: flex; gap: 0; font-size: 13px; color: #8c8c8c; }
  .step {
    flex: 1;
    padding: 8px 0;
    text-align: center;
    border-bottom: 2px solid #e8e8e8;
    transition: all 0.2s;
  }
  .step.active { color: #1677ff; border-bottom-color: #1677ff; font-weight: 500; }
  .step.done { color: #52c41a; border-bottom-color: #52c41a; }
  .body { padding: 24px 32px; min-height: 320px; }
  .body h2 { margin: 0 0 16px 0; font-size: 16px; font-weight: 600; }
  .body p.hint { color: #8c8c8c; font-size: 13px; margin: 0 0 16px 0; }

  table.checks { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 16px; }
  table.checks th, table.checks td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #f0f0f0; }
  table.checks th { background: #fafafa; font-weight: 500; color: #595959; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; }
  .badge-ok { background: #f6ffed; color: #389e0d; border: 1px solid #b7eb8f; }
  .badge-fail { background: #fff1f0; color: #cf1322; border: 1px solid #ffa39e; }
  .badge-warn { background: #fffbe6; color: #d48806; border: 1px solid #ffe58f; }

  .form-row { margin-bottom: 16px; }
  .form-row label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; color: #262626; }
  .form-row label .req { color: #ff4d4f; }
  .form-row .extra { font-size: 12px; color: #8c8c8c; margin-top: 4px; }
  input[type="text"], input[type="password"], input[type="email"], input[type="number"] {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #d9d9d9;
    border-radius: 6px;
    font-size: 14px;
    transition: border-color 0.2s;
    font-family: inherit;
  }
  input:focus { outline: none; border-color: #1677ff; box-shadow: 0 0 0 2px rgba(22,119,255,.1); }
  .row { display: flex; gap: 12px; }
  .row .form-row { flex: 1; }

  .actions {
    padding: 16px 32px;
    border-top: 1px solid #f0f0f0;
    background: #fafafa;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  button {
    padding: 8px 20px;
    border-radius: 6px;
    border: 1px solid transparent;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.15s;
    font-family: inherit;
  }
  button.primary { background: #1677ff; color: #fff; }
  button.primary:hover:not(:disabled) { background: #4096ff; }
  button.primary:disabled { background: #bfbfbf; cursor: not-allowed; }
  button.default { background: #fff; border-color: #d9d9d9; color: #262626; }
  button.default:hover:not(:disabled) { border-color: #1677ff; color: #1677ff; }
  button.default:disabled { background: #f5f5f5; color: #bfbfbf; cursor: not-allowed; }

  .alert {
    padding: 12px 16px;
    border-radius: 6px;
    font-size: 13px;
    margin-bottom: 16px;
    border: 1px solid;
  }
  .alert-info { background: #e6f4ff; border-color: #91caff; color: #003eb3; }
  .alert-error { background: #fff1f0; border-color: #ffa39e; color: #a8071a; }
  .alert-success { background: #f6ffed; border-color: #b7eb8f; color: #389e0d; }
  .alert-warn { background: #fffbe6; border-color: #ffe58f; color: #ad6800; }

  .spinner {
    display: inline-block;
    width: 12px; height: 12px;
    border: 2px solid #d9d9d9;
    border-top-color: #1677ff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    vertical-align: -2px;
    margin-right: 6px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .done-screen { text-align: left; padding: 16px 0; }
  .done-screen .check-circle {
    width: 56px; height: 56px;
    margin: 0 auto 16px;
    border-radius: 50%;
    background: #f6ffed;
    border: 2px solid #52c41a;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    color: #52c41a;
    font-weight: 600;
  }
  .done-screen h2 { color: #389e0d; margin-bottom: 8px; text-align: center; }
  .done-screen p.center { color: #595959; margin: 8px 0; text-align: center; }
  .done-screen .cron-box {
    background: #fafafa;
    border: 1px solid #e8e8e8;
    border-radius: 6px;
    padding: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12.5px;
    color: #262626;
    margin: 8px 0 16px;
    word-break: break-all;
  }
  .done-screen .cta {
    text-align: center;
    margin-top: 16px;
  }
  .done-screen .cta a {
    display: inline-block;
    padding: 10px 24px;
    background: #1677ff;
    color: #fff;
    border-radius: 6px;
    text-decoration: none;
    font-size: 14px;
  }

  details { margin-top: 12px; }
  details summary { cursor: pointer; color: #1677ff; font-size: 13px; }

  code.inline {
    background: #f0f0f0;
    padding: 1px 6px;
    border-radius: 3px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="header">
      <h1>agent-build 安装向导</h1>
      <div class="sub">云打包授权管理端 · 给云控端发放授权 / 管理配额 / 调度 GitHub Actions 打包</div>
      <div class="steps">
        <div class="step active" data-step="1">1. 环境检测</div>
        <div class="step" data-step="2">2. 文件权限</div>
        <div class="step" data-step="3">3. 数据库</div>
        <div class="step" data-step="4">4. 管理员</div>
      </div>
    </div>

    <div class="body" id="body">
      <!-- step 1 -->
      <div class="step-pane" data-step="1">
        <h2>环境检测</h2>
        <p class="hint">检测 PHP 版本、扩展和函数。任何一项失败都需要先解决再继续。</p>
        <div id="env-result"><p><span class="spinner"></span>正在检测...</p></div>
      </div>

      <!-- step 2 -->
      <div class="step-pane" data-step="2" style="display:none">
        <h2>文件权限检测</h2>
        <p class="hint">检测 storage、bootstrap/cache 等目录是否可写，以及 composer 依赖是否就绪。Linux 下常见解决方案：<code class="inline">chmod -R 775 storage bootstrap/cache</code> 并 <code class="inline">chown -R www:www .</code>。</p>
        <div id="perm-result"><p><span class="spinner"></span>正在检测...</p></div>
      </div>

      <!-- step 3 -->
      <div class="step-pane" data-step="3" style="display:none">
        <h2>数据库连接</h2>
        <p class="hint">填写 MySQL 连接信息。agent-build 必须使用<b>独立的数据库</b>（建议 <code class="inline">agent_build</code>），不要与 agent-admin 共用。字符集 utf8mb4 / 排序规则 utf8mb4_unicode_ci。</p>
        <div id="db-alert"></div>
        <div class="row">
          <div class="form-row">
            <label>主机 <span class="req">*</span></label>
            <input type="text" id="db_host" value="127.0.0.1">
            <div class="extra">默认本地 127.0.0.1。远程数据库填对应 IP / 域名。</div>
          </div>
          <div class="form-row" style="flex:0 0 120px">
            <label>端口 <span class="req">*</span></label>
            <input type="number" id="db_port" value="3306">
          </div>
        </div>
        <div class="form-row">
          <label>数据库名 <span class="req">*</span></label>
          <input type="text" id="db_database" placeholder="例如：agent_build">
          <div class="extra">需要提前在 MySQL 里创建好数据库。</div>
        </div>
        <div class="row">
          <div class="form-row">
            <label>用户名 <span class="req">*</span></label>
            <input type="text" id="db_username">
          </div>
          <div class="form-row">
            <label>密码</label>
            <input type="password" id="db_password">
          </div>
        </div>
      </div>

      <!-- step 4 -->
      <div class="step-pane" data-step="4" style="display:none">
        <h2>管理员账号 + GitHub 配置</h2>
        <p class="hint">填写完后点击「立即安装」：写 <code class="inline">.env</code>（含自动生成的 APP_KEY / BUILD_SIGN_SECRET）→ 数据库迁移 → 创建管理员 → 建 artifact 中转目录 → 写入安装锁。</p>
        <div id="install-alert"></div>
        <div class="row">
          <div class="form-row">
            <label>管理员用户名 <span class="req">*</span></label>
            <input type="text" id="admin_username" maxlength="50" placeholder="字母 / 数字 / 下划线，3-50 位">
          </div>
          <div class="form-row">
            <label>显示名（可选）</label>
            <input type="text" id="admin_name" maxlength="50" placeholder="留空则与用户名相同">
          </div>
        </div>
        <div class="row">
          <div class="form-row">
            <label>管理员密码 <span class="req">*</span></label>
            <input type="password" id="admin_password" placeholder="至少 6 位">
          </div>
          <div class="form-row">
            <label>确认密码 <span class="req">*</span></label>
            <input type="password" id="admin_password_confirm">
          </div>
        </div>

        <div class="form-row">
          <label>GitHub 仓库</label>
          <input type="text" id="github_repo" value="your-org/your-build-repo">
          <div class="extra">格式 <code class="inline">owner/repo</code>。默认指向 <code class="inline">local-agent-build</code> 模板仓库。</div>
        </div>
        <div class="form-row">
          <label>GitHub fine-grained PAT（可选）</label>
          <input type="password" id="github_token" placeholder="github_pat_... 可留空，安装后在 .env 修改">
          <div class="extra">权限需勾选 <b>Actions: Read and write</b>（对上面仓库）。留空时打包会降级为 queued 状态不真实触发，仅测试用。</div>
        </div>
      </div>

      <!-- done -->
      <div class="step-pane" data-step="done" style="display:none">
        <div class="done-screen">
          <div class="check-circle">&#10003;</div>
          <h2>安装完成</h2>
          <p class="center" id="done-msg">管理员账号已创建。</p>

          <div class="alert alert-warn" style="margin-top:16px">
            <b>下一步必做：配置 cron</b><br>
            必须跑 Laravel scheduler，否则 <code class="inline">BuildWorker</code> / <code class="inline">BuildAckTimeout</code> / <code class="inline">BuildStuckDetector</code> 不会启动，打包任务会卡在 success 拉不到 artifact。
            <br><br>
            在<b>宝塔面板 → 计划任务</b>添加「Shell 脚本」，执行周期<b>每 1 分钟</b>，命令：
            <div class="cron-box" id="cron-line"></div>
          </div>

          <div id="github-token-warn" class="alert alert-warn" style="display:none">
            <b>GitHub Token 未填</b>：当前打包会降级为 queued 状态不真实触发。
            去 <code class="inline">backend/.env</code> 把 <code class="inline">GITHUB_BUILD_TOKEN</code> 补上后运行 <code class="inline">php artisan config:clear</code> 即可生效。
          </div>

          <div class="alert alert-info">
            <b>安全建议</b>：立即删除 <code class="inline">public/install.php</code>（虽然 installed.lock 已经锁住，但物理删除更稳妥）。
          </div>

          <div class="cta">
            <a id="done-link" href="/admin/">进入管理后台</a>
          </div>
        </div>
      </div>
    </div>

    <div class="actions" id="actions">
      <button class="default" id="btn-back" onclick="prevStep()" disabled>上一步</button>
      <div style="display:flex; gap:8px">
        <button class="default" id="btn-aux"></button>
        <button class="primary" id="btn-next" onclick="nextStep()" disabled>下一步</button>
      </div>
    </div>
  </div>
</div>

<script>
const STATE = {
  step: 1,
  envOk: false,
  permOk: false,
  dbOk: false,
  dbConfig: null,
};

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function api(action, body) {
  return fetch('install.php?action=' + action, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => r.json());
}

function showStep(step) {
  STATE.step = step;
  $$('.step-pane').forEach(p => p.style.display = 'none');
  const target = $(`.step-pane[data-step="${step}"]`);
  if (target) target.style.display = '';

  $$('.step').forEach(el => {
    const n = parseInt(el.dataset.step, 10);
    el.classList.remove('active', 'done');
    if (n < step || (n === 4 && step === 'done')) el.classList.add('done');
    else if (String(n) === String(step)) el.classList.add('active');
  });

  $('#btn-back').disabled = (step === 1 || step === 'done');
  $('#btn-next').disabled = true;

  const aux = $('#btn-aux');
  if (step === 1) {
    aux.textContent = '重新检测';
    aux.style.display = '';
    aux.onclick = checkEnv;
    $('#btn-next').textContent = '下一步';
    $('#btn-next').disabled = !STATE.envOk;
  } else if (step === 2) {
    aux.textContent = '重新检测';
    aux.style.display = '';
    aux.onclick = checkPerms;
    $('#btn-next').disabled = !STATE.permOk;
  } else if (step === 3) {
    aux.textContent = '测试连接';
    aux.style.display = '';
    aux.onclick = testDb;
    $('#btn-next').disabled = !STATE.dbOk;
  } else if (step === 4) {
    aux.style.display = 'none';
    $('#btn-next').textContent = '立即安装';
    $('#btn-next').disabled = false;
  } else if (step === 'done') {
    $('#actions').style.display = 'none';
  }
}

function nextStep() {
  if (STATE.step === 1 && STATE.envOk) { showStep(2); checkPerms(); }
  else if (STATE.step === 2 && STATE.permOk) showStep(3);
  else if (STATE.step === 3 && STATE.dbOk) showStep(4);
  else if (STATE.step === 4) doInstall();
}
function prevStep() {
  if (typeof STATE.step === 'number' && STATE.step > 1) showStep(STATE.step - 1);
}

function renderChecks(containerId, data, label) {
  const c = $(containerId);
  if (!data) { c.innerHTML = '<div class="alert alert-error">检测失败，请重试</div>'; return; }
  let html = '';
  if (data.ok) {
    html += `<div class="alert alert-success">${label}全部通过，可以进入下一步。</div>`;
  } else {
    html += `<div class="alert alert-error">${label}存在不通过项，请先修复后点击「重新检测」。</div>`;
  }
  html += '<table class="checks"><thead><tr><th style="width:40%">检查项</th><th>要求</th><th>实际</th><th style="width:80px">状态</th></tr></thead><tbody>';
  data.checks.forEach(c => {
    html += `<tr>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.required)}</td>
      <td>${escapeHtml(c.actual)}</td>
      <td><span class="badge ${c.ok ? 'badge-ok' : 'badge-fail'}">${c.ok ? '通过' : '失败'}</span></td>
    </tr>`;
  });
  html += '</tbody></table>';
  c.innerHTML = html;
}

async function checkEnv() {
  $('#env-result').innerHTML = '<p><span class="spinner"></span>正在检测...</p>';
  const data = await api('check_env');
  STATE.envOk = !!data.ok;
  renderChecks('#env-result', data, '环境检测');
  if (STATE.step === 1) $('#btn-next').disabled = !STATE.envOk;
}

async function checkPerms() {
  $('#perm-result').innerHTML = '<p><span class="spinner"></span>正在检测...</p>';
  const data = await api('check_perms');
  STATE.permOk = !!data.ok;
  renderChecks('#perm-result', data, '权限检测');
  if (STATE.step === 2) $('#btn-next').disabled = !STATE.permOk;
}

async function testDb() {
  const cfg = collectDbConfig();
  if (!cfg) return;
  $('#db-alert').innerHTML = '<div class="alert alert-info"><span class="spinner"></span>正在测试连接...</div>';
  const data = await api('test_db', cfg);
  if (data.ok) {
    STATE.dbOk = true;
    STATE.dbConfig = cfg;
    let msg = `连接成功。MySQL ${escapeHtml(data.mysql_version || '')}，字符集 ${escapeHtml(data.database_charset || '')}。`;
    if (data.charset_warning) {
      $('#db-alert').innerHTML = `<div class="alert alert-success">${msg}</div><div class="alert alert-warn">${escapeHtml(data.charset_warning)}</div>`;
    } else {
      $('#db-alert').innerHTML = `<div class="alert alert-success">${msg}</div>`;
    }
  } else {
    STATE.dbOk = false;
    STATE.dbConfig = null;
    $('#db-alert').innerHTML = `<div class="alert alert-error">连接失败：${escapeHtml(data.error || '')}</div>`;
  }
  if (STATE.step === 3) $('#btn-next').disabled = !STATE.dbOk;
}

function collectDbConfig() {
  const host = $('#db_host').value.trim();
  const port = parseInt($('#db_port').value, 10) || 3306;
  const database = $('#db_database').value.trim();
  const username = $('#db_username').value.trim();
  const password = $('#db_password').value;
  if (!host || !database || !username) {
    $('#db-alert').innerHTML = '<div class="alert alert-warn">请先填写 主机 / 数据库名 / 用户名</div>';
    return null;
  }
  return { host, port, database, username, password };
}

async function doInstall() {
  const adminUser = $('#admin_username').value.trim();
  const adminName = $('#admin_name').value.trim();
  const adminPass = $('#admin_password').value;
  const adminConfirm = $('#admin_password_confirm').value;
  const githubToken = $('#github_token').value.trim();
  const githubRepo = $('#github_repo').value.trim();

  const errs = [];
  if (!adminUser || adminUser.length < 3) errs.push('管理员用户名至少 3 个字符');
  if (!/^[a-zA-Z0-9_]{3,50}$/.test(adminUser)) errs.push('用户名只能含字母 / 数字 / 下划线');
  if (adminPass.length < 6) errs.push('密码至少 6 个字符');
  if (adminPass !== adminConfirm) errs.push('两次输入的密码不一致');
  if (adminName && adminName.length > 50) errs.push('显示名最长 50 字');
  if (githubRepo && !/^[\w.\-]+\/[\w.\-]+$/.test(githubRepo)) errs.push('GitHub 仓库格式应为 owner/repo');

  if (errs.length) {
    $('#install-alert').innerHTML = `<div class="alert alert-error">${errs.map(escapeHtml).join('；')}</div>`;
    return;
  }

  $('#install-alert').innerHTML = '<div class="alert alert-info"><span class="spinner"></span>正在安装：写入 .env → 数据库迁移 → 创建管理员 → 建存储目录 → 写入安装锁</div>';
  $('#btn-next').disabled = true;
  $('#btn-back').disabled = true;

  const payload = {
    admin_username: adminUser,
    admin_password: adminPass,
    admin_name: adminName,
    github_token: githubToken,
    github_repo: githubRepo,
    db_host: STATE.dbConfig.host,
    db_port: STATE.dbConfig.port,
    db_database: STATE.dbConfig.database,
    db_username: STATE.dbConfig.username,
    db_password: STATE.dbConfig.password,
  };
  const data = await api('install', payload);
  if (data.ok) {
    $('#done-msg').textContent = `管理员账号：${data.admin_user}。请先完成下方 cron 配置后再使用。`;
    $('#cron-line').textContent = data.cron_line || '';
    if (!data.github_token_set) {
      $('#github-token-warn').style.display = '';
    }
    $('#done-link').href = data.redirect || '/admin/';
    showStep('done');
  } else {
    let html = `<div class="alert alert-error">${escapeHtml(data.error || '安装失败')}</div>`;
    if (data.output) html += `<pre style="background:#fafafa;padding:12px;border-radius:6px;font-size:12px;max-height:240px;overflow:auto">${escapeHtml(data.output)}</pre>`;
    if (data.where) html += `<p style="font-size:12px;color:#8c8c8c">${escapeHtml(data.where)}</p>`;
    $('#install-alert').innerHTML = html;
    $('#btn-next').disabled = false;
    $('#btn-back').disabled = false;
  }
}

// 启动
showStep(1);
checkEnv();
</script>
</body>
</html>
