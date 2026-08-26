<?php

namespace App\Services;

use App\Models\UpdateLog;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use ZipArchive;

/**
 * 在线更新服务
 *
 * 流程：
 *   check()   → 拉远端 version.json，对比本地版本
 *   apply()   → 异步执行升级（下载 / 校验 / 备份 / 解压 / 迁移 / 清缓存）
 *   progress()→ 查询当前 / 指定 log 的进度
 *   history() → 升级历史
 */
class UpdateService
{
    public const PHASE_INIT = 'init';
    public const PHASE_DOWNLOADING = 'downloading';
    public const PHASE_VERIFYING = 'verifying';
    public const PHASE_BACKING_UP = 'backing_up';
    public const PHASE_EXTRACTING = 'extracting';
    public const PHASE_MIGRATING = 'migrating';
    public const PHASE_CLEARING_CACHE = 'clearing_cache';
    public const PHASE_COMPLETED = 'completed';

    /** 每个阶段对应的进度上限百分比 */
    public const PHASE_PERCENT = [
        self::PHASE_INIT => 0,
        self::PHASE_DOWNLOADING => 40,
        self::PHASE_VERIFYING => 45,
        self::PHASE_BACKING_UP => 60,
        self::PHASE_EXTRACTING => 85,
        self::PHASE_MIGRATING => 95,
        self::PHASE_CLEARING_CACHE => 99,
        self::PHASE_COMPLETED => 100,
    ];

    /**
     * 框架 / 官方包内置的表（不在 database/migrations/*.php 但属于"应该存在"）
     * - migrations：Laravel 迷踪迁移状态表（框架自建）
     * - personal_access_tokens：Laravel Sanctum 包的 API token 表（vendor migration）
     * 加入后，数据表检查页 UI 不会再把它们归到"额外表"造成误解。
     */
    public const FRAMEWORK_TABLES = [
        'migrations',
        'personal_access_tokens',
    ];

    /** 解压时跳过的相对路径（防御性，理论上 zip 不该带这些） */
    public const PROTECTED_PATHS = [
        '.env',
        '.env.example',
        'storage/',
        'bootstrap/cache/',
        'database/database.sqlite',
    ];

    /** 锁文件路径 */
    protected function lockPath(): string
    {
        return storage_path('app/updating.lock');
    }

    /** 当前本地版本号 */
    public function currentVersion(): string
    {
        return (string) config('version.version', '1.0.0');
    }

    /** 当前发布日期 */
    public function currentReleasedAt(): string
    {
        return (string) config('version.released_at', '');
    }

    // ============================================================
    // 权限预检
    // ============================================================

    /**
     * 检查项目根目录及关键子目录的写权限。
     */
    public function probeWritable(): array
    {
        $basePath = base_path();
        $phpUser = $this->getCurrentPhpUser();

        $badPaths = [];
        $token = 'probe_' . uniqid();

        // 测试根目录
        $rootProbe = $basePath . DIRECTORY_SEPARATOR . '.update_' . $token;
        if (@file_put_contents($rootProbe, '1') === false) {
            $badPaths[] = '.'; // 根目录
        } else {
            @unlink($rootProbe);
        }

        // 测试核心子目录（升级会覆盖它们）
        $subdirs = ['app', 'config', 'routes', 'resources', 'database', 'public', 'vendor'];
        foreach ($subdirs as $sub) {
            $dir = $basePath . DIRECTORY_SEPARATOR . $sub;
            if (!is_dir($dir)) continue;
            $probe = $dir . DIRECTORY_SEPARATOR . '.update_' . $token;
            if (@file_put_contents($probe, '1') === false) {
                $badPaths[] = $sub;
            } else {
                @unlink($probe);
            }
        }

        $ok = empty($badPaths);

        $fixScript = '';
        if (!$ok && PHP_OS_FAMILY !== 'Windows' && $phpUser !== '') {
            $fixScript = implode("\n", [
                "# 1) 代码目录属主改为 {$phpUser}，权限 750（others 看不到源码）",
                "chown -R {$phpUser}:{$phpUser} {$basePath}",
                "chmod -R 750 {$basePath}",
                "",
                "# 2) public/ 保持 755 让 Nginx 读静态资源",
                "chmod -R 755 {$basePath}/public",
                "",
                "# 3) .env 高敏感，仅 root 可写、{$phpUser} 可读",
                "chown root:{$phpUser} {$basePath}/.env",
                "chmod 640 {$basePath}/.env",
                "",
                "# 4) storage 与 bootstrap/cache 按 Laravel 规范 775",
                "chmod -R 775 {$basePath}/storage",
                "chmod -R 775 {$basePath}/bootstrap/cache",
            ]);
        }

        if ($ok) {
            $message = '项目根目录及核心子目录均可写';
        } else {
            $userLabel = $phpUser !== '' ? $phpUser : '当前 PHP 进程';
            $message = sprintf(
                '项目根目录不可写：%s 对这些路径无写权限 [%s]。升级将无法解压新代码。',
                $userLabel,
                implode(', ', $badPaths)
            );
        }

        return [
            'ok' => $ok,
            'base_path' => $basePath,
            'php_user' => $phpUser,
            'message' => $message,
            'fix_script' => $fixScript,
            'bad_paths' => $badPaths,
        ];
    }

    /** 获取当前 PHP 进程的用户名（Linux 优先 posix_*，Windows 回落到 get_current_user） */
    protected function getCurrentPhpUser(): string
    {
        if (function_exists('posix_geteuid') && function_exists('posix_getpwuid')) {
            $info = @posix_getpwuid(posix_geteuid());
            if (is_array($info) && !empty($info['name'])) {
                return (string) $info['name'];
            }
        }
        if (function_exists('get_current_user')) {
            return (string) @get_current_user();
        }
        return '';
    }

    // ============================================================
    // 检查更新
    // ============================================================

    public function check(): array
    {
        $url = (string) config('version.check_url');
        if ($url === '') {
            throw new \RuntimeException('未配置远端更新源 (config/version.php check_url)');
        }

        try {
            $resp = Http::timeout((int) config('version.http_timeout', 30))
                ->withOptions(['verify' => true])
                ->get($url);
        } catch (\Throwable $e) {
            throw new \RuntimeException('请求远端更新源失败：' . $e->getMessage());
        }

        if (!$resp->successful()) {
            throw new \RuntimeException("远端更新源返回 HTTP {$resp->status()}");
        }

        $data = $resp->json();
        if (!is_array($data) || !isset($data['latest'], $data['zip_url'], $data['sha256'])) {
            throw new \RuntimeException('远端 version.json 格式不合法（缺少 latest / zip_url / sha256 字段）');
        }

        // 安全：zip_url 必须在白名单域名内
        $allowed = (array) config('version.allowed_zip_hosts', []);
        $host = parse_url((string) $data['zip_url'], PHP_URL_HOST);
        if (!in_array($host, $allowed, true)) {
            throw new \RuntimeException("zip_url 域名 [{$host}] 不在白名单中");
        }

        $current = $this->currentVersion();
        $latest = (string) $data['latest'];
        $minFrom = (string) ($data['min_upgradable_from'] ?? $current);

        $cmp = $this->compareVersion($latest, $current);
        $minOk = $this->compareVersion($current, $minFrom) >= 0;

        return [
            'current' => $current,
            'current_released_at' => $this->currentReleasedAt(),
            'latest' => $latest,
            'released_at' => (string) ($data['released_at'] ?? ''),
            'upgradable' => $cmp > 0 && $minOk,
            'is_latest' => $cmp <= 0,
            'too_old' => $cmp > 0 && !$minOk,
            'min_upgradable_from' => $minFrom,
            'breaking' => (bool) ($data['breaking'] ?? false),
            'zip_url' => (string) $data['zip_url'],
            'sha256' => strtolower((string) $data['sha256']),
            'size' => (int) ($data['size'] ?? 0),
            'changelog' => array_values((array) ($data['changelog'] ?? [])),
            'previous_versions' => array_values((array) ($data['previous_versions'] ?? [])),
        ];
    }

    /**
     * 比较两个语义化版本号
     * @return int  1=$a>$b, 0=eq, -1=$a<$b
     */
    public function compareVersion(string $a, string $b): int
    {
        $pa = array_map('intval', array_pad(explode('.', $a), 3, 0));
        $pb = array_map('intval', array_pad(explode('.', $b), 3, 0));
        for ($i = 0; $i < 3; $i++) {
            if ($pa[$i] !== $pb[$i]) return $pa[$i] > $pb[$i] ? 1 : -1;
        }
        return 0;
    }

    // ============================================================
    // 进度查询 / 历史
    // ============================================================

    public function runningLog(): ?UpdateLog
    {
        $log = UpdateLog::where('status', UpdateLog::STATUS_RUNNING)
            ->orderByDesc('id')->first();
        if (!$log) return null;

        $stale = $log->updated_at && $log->updated_at->diffInSeconds(now()) > 3600;
        if ($stale) {
            UpdateLog::where('id', $log->id)->update([
                'status' => UpdateLog::STATUS_FAILED,
                'error_message' => '升级进程超过 1 小时无响应，已自动标记为失败',
                'finished_at' => now(),
            ]);
            @unlink($this->lockPath());
            return null;
        }
        return $log;
    }

    public function progress(?int $logId = null): ?UpdateLog
    {
        if ($logId) {
            return UpdateLog::find($logId);
        }
        return UpdateLog::orderByDesc('id')->first();
    }

    public function history(int $perPage = 20)
    {
        return UpdateLog::orderByDesc('id')->paginate($perPage);
    }

    // ============================================================
    // 锁
    // ============================================================

    protected function acquireLock(): bool
    {
        $path = $this->lockPath();
        @mkdir(dirname($path), 0755, true);
        if (file_exists($path)) {
            $age = time() - (int) @filemtime($path);
            if ($age < 3600) return false;
            @unlink($path);
        }
        return @file_put_contents($path, json_encode([
            'pid' => getmypid(),
            'time' => time(),
        ])) !== false;
    }

    protected function releaseLock(): void
    {
        @unlink($this->lockPath());
    }

    // ============================================================
    // 入口：apply
    // ============================================================

    public function apply(int $operatorId, string $operatorName): UpdateLog
    {
        $writable = $this->probeWritable();
        if (!$writable['ok']) {
            throw new \RuntimeException(
                $writable['message'] . '（请在「在线更新」页面查看完整修复命令）'
            );
        }

        if ($this->runningLog()) {
            throw new \RuntimeException('已有升级任务正在执行中，请等待完成');
        }
        if (!$this->acquireLock()) {
            throw new \RuntimeException('获取升级锁失败，可能有其他升级任务正在执行');
        }

        $log = null;
        try {
            $info = $this->check();
            if (!$info['upgradable']) {
                if ($info['is_latest']) {
                    throw new \RuntimeException('已是最新版本，无需升级');
                }
                if ($info['too_old']) {
                    throw new \RuntimeException("当前版本 {$info['current']} 过低，需要先升级到 {$info['min_upgradable_from']} 以上");
                }
                throw new \RuntimeException('当前不可升级');
            }

            $log = UpdateLog::create([
                'from_version' => $info['current'],
                'to_version' => $info['latest'],
                'status' => UpdateLog::STATUS_RUNNING,
                'phase' => self::PHASE_INIT,
                'progress_percent' => 0,
                'zip_url' => $info['zip_url'],
                'zip_sha256' => $info['sha256'],
                'zip_size' => $info['size'],
                'operator_id' => $operatorId,
                'operator_name' => $operatorName,
                'started_at' => now(),
                'log' => "[" . now()->toDateTimeString() . "] 升级任务已创建：{$info['current']} → {$info['latest']}\n",
            ]);
        } catch (\Throwable $e) {
            $this->releaseLock();
            throw $e;
        }

        $this->detachAndRun($log->id);

        return $log->fresh();
    }

    protected function detachAndRun(int $logId): void
    {
        if (function_exists('fastcgi_finish_request')) {
            register_shutdown_function(function () use ($logId) {
                @ignore_user_abort(true);
                @set_time_limit(0);
                fastcgi_finish_request();
                $this->run($logId);
            });
            return;
        }

        @ignore_user_abort(true);
        @set_time_limit(0);
        $this->run($logId);
    }

    // ============================================================
    // 后台主流程
    // ============================================================

    protected function run(int $logId): void
    {
        $log = UpdateLog::find($logId);
        if (!$log) {
            $this->releaseLock();
            return;
        }

        $startTs = microtime(true);
        $zipPath = null;

        try {
            $this->appendLog($log, '开始下载更新包：' . $log->zip_url);
            $zipPath = $this->phaseDownload($log);

            $this->appendLog($log, '校验文件完整性 (SHA256)');
            $this->phaseVerify($log, $zipPath);

            $this->appendLog($log, '备份当前代码与数据库');
            $backupPath = $this->phaseBackup($log);
            UpdateLog::where('id', $log->id)->update(['backup_path' => $backupPath]);
            $log->backup_path = $backupPath;

            $this->appendLog($log, '解压更新包到站点根目录');
            $this->phaseExtract($log, $zipPath);

            $this->appendLog($log, '执行数据库迁移 (php artisan migrate --force)');
            $this->phaseMigrate($log);

            $this->appendLog($log, '清理 Laravel 缓存');
            $this->phaseClearCache($log);

            $this->setPhase($log, self::PHASE_COMPLETED, 100);
            $duration = (int) (microtime(true) - $startTs);
            UpdateLog::where('id', $log->id)->update([
                'status' => UpdateLog::STATUS_SUCCESS,
                'finished_at' => now(),
                'duration_seconds' => $duration,
            ]);
            $this->appendLog($log, "升级成功，耗时 {$duration}s");

            if ($zipPath) @unlink($zipPath);
        } catch (\Throwable $e) {
            UpdateLog::where('id', $log->id)->update([
                'status' => UpdateLog::STATUS_FAILED,
                'error_message' => $e->getMessage(),
                'finished_at' => now(),
                'duration_seconds' => (int) (microtime(true) - $startTs),
            ]);
            $this->appendLog($log, '升级失败：' . $e->getMessage());
            Log::error('[UpdateService] apply failed', [
                'log_id' => $logId,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
            if ($zipPath) @unlink($zipPath);
        } finally {
            $this->releaseLock();
        }
    }

    // ============================================================
    // Phase 1: 下载
    // ============================================================
    protected function phaseDownload(UpdateLog $log): string
    {
        $this->setPhase($log, self::PHASE_DOWNLOADING, 5);

        $dir = storage_path('app/updates');
        @mkdir($dir, 0755, true);
        $zipPath = $dir . '/' . basename(parse_url($log->zip_url, PHP_URL_PATH));

        $fp = @fopen($zipPath, 'w');
        if (!$fp) throw new \RuntimeException("无法创建临时文件 {$zipPath}");

        $ch = curl_init($log->zip_url);
        curl_setopt_array($ch, [
            CURLOPT_FILE => $fp,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => (int) config('version.download_timeout', 600),
            CURLOPT_CONNECTTIMEOUT => 30,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_USERAGENT => 'AgentBuild-Updater/1.0',
            CURLOPT_NOPROGRESS => false,
            CURLOPT_PROGRESSFUNCTION => function ($_, $dlTotal, $dlNow) use ($log) {
                if ($dlTotal <= 0) return 0;
                static $lastPct = 0;
                $pct = (int) min(40, 5 + ($dlNow / $dlTotal) * 35);
                if ($pct - $lastPct >= 2) {
                    $lastPct = $pct;
                    UpdateLog::where('id', $log->id)->update(['progress_percent' => $pct]);
                }
                return 0;
            },
        ]);
        $ok = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        fclose($fp);

        if (!$ok || $httpCode !== 200) {
            @unlink($zipPath);
            throw new \RuntimeException("下载失败 (HTTP {$httpCode}): {$err}");
        }

        $size = filesize($zipPath);
        $this->appendLog($log, "下载完成 (" . $this->formatBytes($size) . ")");
        $this->setPhase($log, self::PHASE_DOWNLOADING, 40);
        return $zipPath;
    }

    // ============================================================
    // Phase 2: 校验 SHA256
    // ============================================================
    protected function phaseVerify(UpdateLog $log, string $zipPath): void
    {
        $this->setPhase($log, self::PHASE_VERIFYING, 42);

        $expected = strtolower((string) $log->zip_sha256);
        if ($expected === '') {
            throw new \RuntimeException('远端 sha256 为空，拒绝继续');
        }
        $actual = strtolower((string) hash_file('sha256', $zipPath));
        if ($actual !== $expected) {
            @unlink($zipPath);
            throw new \RuntimeException("SHA256 校验失败 expected={$expected} actual={$actual}");
        }
        $this->appendLog($log, "SHA256 匹配");
        $this->setPhase($log, self::PHASE_VERIFYING, 45);
    }

    // ============================================================
    // Phase 3: 备份代码 + 数据库
    // ============================================================
    protected function phaseBackup(UpdateLog $log): string
    {
        $this->setPhase($log, self::PHASE_BACKING_UP, 47);

        $stamp = date('Y-m-d-His');
        $backupDir = storage_path("app/backups/{$stamp}");
        @mkdir($backupDir, 0755, true);

        $codeBackup = $backupDir . '/code.zip';
        $zip = new ZipArchive();
        if ($zip->open($codeBackup, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new \RuntimeException("无法创建备份 zip：{$codeBackup}");
        }

        $base = base_path();
        $backupTargets = ['app', 'config', 'database/migrations', 'routes', 'resources', 'public/admin'];
        foreach ($backupTargets as $rel) {
            $abs = $base . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $rel);
            if (!is_dir($abs)) continue;
            $this->addDirToZip($zip, $abs, $rel);
        }
        foreach (['composer.json', 'composer.lock'] as $f) {
            $abs = $base . DIRECTORY_SEPARATOR . $f;
            if (is_file($abs)) $zip->addFile($abs, $f);
        }
        $zip->close();
        $this->appendLog($log, '代码已备份至 ' . str_replace($base, '', $codeBackup));

        try {
            $this->backupMysql($backupDir, $log);
        } catch (\Throwable $e) {
            $this->appendLog($log, '数据库备份跳过：' . $e->getMessage());
        }

        try {
            $this->pruneOldBackups($log, (int) config('version.backup_keep_count', 5));
        } catch (\Throwable $e) {
            $this->appendLog($log, '旧备份清理跳过：' . $e->getMessage());
        }

        $this->setPhase($log, self::PHASE_BACKING_UP, 60);
        return $backupDir;
    }

    protected function pruneOldBackups(UpdateLog $log, int $keep): void
    {
        $keep = max(1, $keep);
        $root = storage_path('app/backups');
        if (!is_dir($root)) return;

        $entries = @scandir($root) ?: [];
        $dirs = [];
        foreach ($entries as $name) {
            if ($name === '.' || $name === '..') continue;
            if (!preg_match('/^\d{4}-\d{2}-\d{2}-\d{6}$/', $name)) continue;
            $abs = $root . DIRECTORY_SEPARATOR . $name;
            if (is_dir($abs)) $dirs[] = $name;
        }
        if (count($dirs) <= $keep) return;

        sort($dirs);
        $toRemove = array_slice($dirs, 0, count($dirs) - $keep);
        $removed = [];
        foreach ($toRemove as $name) {
            $abs = $root . DIRECTORY_SEPARATOR . $name;
            if ($this->rmDirRecursive($abs)) {
                $removed[] = $name;
            }
        }
        if ($removed) {
            $this->appendLog($log, '已清理 ' . count($removed) . ' 份旧备份 (保留最近 ' . $keep . ' 份)：' . implode(', ', $removed));
        }
    }

    protected function rmDirRecursive(string $dir): bool
    {
        if (!is_dir($dir) || is_link($dir)) return @unlink($dir);
        $entries = @scandir($dir) ?: [];
        foreach ($entries as $name) {
            if ($name === '.' || $name === '..') continue;
            $abs = $dir . DIRECTORY_SEPARATOR . $name;
            if (is_dir($abs) && !is_link($abs)) {
                $this->rmDirRecursive($abs);
            } else {
                @unlink($abs);
            }
        }
        return @rmdir($dir);
    }

    protected function addDirToZip(ZipArchive $zip, string $absDir, string $relDir): void
    {
        $rii = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($absDir, \FilesystemIterator::SKIP_DOTS)
        );
        foreach ($rii as $file) {
            if ($file->isDir()) continue;
            $absPath = $file->getPathname();
            $rel = $relDir . '/' . str_replace('\\', '/', substr($absPath, strlen($absDir) + 1));
            $zip->addFile($absPath, $rel);
        }
    }

    protected function backupMysql(string $dir, UpdateLog $log): void
    {
        $conn = config('database.default');
        if ($conn !== 'mysql') {
            $this->appendLog($log, '当前数据库非 MySQL，跳过 dump');
            return;
        }
        $cfg = config('database.connections.mysql');
        $mysqldump = $this->findMysqldump();
        if (!$mysqldump) {
            $this->appendLog($log, '未找到 mysqldump 可执行文件，跳过 DB 备份');
            return;
        }

        $dumpFile = $dir . '/database.sql';
        $cmd = sprintf(
            '%s -h%s -P%d -u%s --default-character-set=%s --single-transaction --quick %s > %s 2>&1',
            escapeshellarg($mysqldump),
            escapeshellarg($cfg['host']),
            (int) $cfg['port'],
            escapeshellarg($cfg['username']),
            escapeshellarg($cfg['charset'] ?? 'utf8mb4'),
            escapeshellarg($cfg['database']),
            escapeshellarg($dumpFile)
        );
        $env = ['MYSQL_PWD' => (string) $cfg['password']];

        $descriptors = [1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
        $proc = @proc_open($cmd, $descriptors, $pipes, null, $env);
        if (!is_resource($proc)) {
            throw new \RuntimeException('proc_open 启动 mysqldump 失败');
        }
        $stdout = stream_get_contents($pipes[1]); fclose($pipes[1]);
        $stderr = stream_get_contents($pipes[2]); fclose($pipes[2]);
        $code = proc_close($proc);
        if ($code !== 0) {
            throw new \RuntimeException("mysqldump exit {$code}: " . trim($stderr));
        }
        $size = is_file($dumpFile) ? filesize($dumpFile) : 0;
        $this->appendLog($log, '数据库已备份 (' . $this->formatBytes($size) . ')');
    }

    protected function findMysqldump(): ?string
    {
        $candidates = [];
        if (PHP_OS_FAMILY === 'Windows') {
            $candidates = [
                'D:\\BtSoft\\mysql\\MySQL5.7\\bin\\mysqldump.exe',
                'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe',
                'C:\\Program Files\\MySQL\\MySQL Server 5.7\\bin\\mysqldump.exe',
                'mysqldump',
            ];
        } else {
            $candidates = [
                '/www/server/mysql/bin/mysqldump',
                '/usr/bin/mysqldump',
                '/usr/local/bin/mysqldump',
                'mysqldump',
            ];
        }
        foreach ($candidates as $c) {
            if (is_file($c)) return $c;
        }
        $which = PHP_OS_FAMILY === 'Windows' ? 'where mysqldump' : 'which mysqldump';
        $out = @shell_exec($which);
        if ($out) {
            $first = trim(explode("\n", trim($out))[0]);
            if ($first && is_file($first)) return $first;
        }
        return null;
    }

    // ============================================================
    // Phase 4: 解压
    // ============================================================
    protected function phaseExtract(UpdateLog $log, string $zipPath): void
    {
        $this->setPhase($log, self::PHASE_EXTRACTING, 62);

        $base = base_path();
        $zip = new ZipArchive();
        if ($zip->open($zipPath) !== true) {
            throw new \RuntimeException('无法打开更新包 zip');
        }

        $total = $zip->numFiles;
        if ($total === 0) {
            $zip->close();
            throw new \RuntimeException('更新包为空');
        }

        $extracted = 0;
        $skipped = 0;
        for ($i = 0; $i < $total; $i++) {
            $name = $zip->getNameIndex($i);
            if ($name === false) continue;
            $name = str_replace('\\', '/', $name);

            if ($name === '' || $name[0] === '/' || str_contains($name, '..')) {
                $skipped++;
                continue;
            }
            if ($this->isProtectedPath($name)) {
                $skipped++;
                continue;
            }

            $target = $base . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $name);

            if (str_ends_with($name, '/')) {
                @mkdir($target, 0755, true);
                continue;
            }

            @mkdir(dirname($target), 0755, true);

            $stream = $zip->getStream($name);
            if (!$stream) {
                throw new \RuntimeException("读取 zip 项失败：{$name}");
            }
            $out = @fopen($target, 'wb');
            if (!$out) {
                fclose($stream);
                throw new \RuntimeException("写入文件失败：{$target}");
            }
            stream_copy_to_stream($stream, $out);
            fclose($stream);
            fclose($out);
            $extracted++;

            if ($extracted % 50 === 0 || $i === $total - 1) {
                $pct = (int) min(85, 62 + ($i / $total) * 23);
                UpdateLog::where('id', $log->id)->update(['progress_percent' => $pct]);
            }
        }
        $zip->close();
        $this->appendLog($log, "解压完成：{$extracted} 文件" . ($skipped > 0 ? "（跳过 {$skipped} 项保护文件）" : ''));

        $cacheDir = $base . '/bootstrap/cache';
        if (!is_dir($cacheDir)) @mkdir($cacheDir, 0755, true);

        $this->purgeBootstrapCache($cacheDir, $log);

        $this->setPhase($log, self::PHASE_EXTRACTING, 85);
    }

    protected function purgeBootstrapCache(string $cacheDir, ?UpdateLog $log = null): void
    {
        if (!is_dir($cacheDir)) return;
        $patterns = [
            'packages.php',
            'services.php',
            'config.php',
            'compiled.php',
            'routes-v7.php',
            'routes-v6.php',
            'events.php',
        ];
        $removed = [];
        foreach ($patterns as $name) {
            $f = $cacheDir . '/' . $name;
            if (is_file($f) && @unlink($f)) {
                $removed[] = $name;
            }
        }
        if ($log && $removed) {
            $this->appendLog($log, '已清理 bootstrap/cache：' . implode(', ', $removed));
        }
    }

    protected function isProtectedPath(string $name): bool
    {
        foreach (self::PROTECTED_PATHS as $p) {
            if ($name === rtrim($p, '/') || str_starts_with($name, $p)) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // Phase 5: 数据库迁移
    // ============================================================
    protected function phaseMigrate(UpdateLog $log): void
    {
        $this->setPhase($log, self::PHASE_MIGRATING, 87);
        try {
            $code = Artisan::call('migrate', ['--force' => true]);
            $output = Artisan::output();
            $this->appendLog($log, "migrate 输出：\n" . trim($output));
            if ($code !== 0) {
                throw new \RuntimeException("migrate 退出码 {$code}");
            }
        } catch (\Throwable $e) {
            throw new \RuntimeException('migrate 执行失败：' . $e->getMessage());
        }
        $this->setPhase($log, self::PHASE_MIGRATING, 95);
    }

    // ============================================================
    // Phase 6: 清缓存
    // ============================================================
    protected function phaseClearCache(UpdateLog $log): void
    {
        $this->setPhase($log, self::PHASE_CLEARING_CACHE, 96);

        $base = $this->resolveProjectRoot();
        if ($base) $this->purgeBootstrapCache($base . '/bootstrap/cache', $log);

        $cmds = ['clear-compiled', 'config:clear', 'route:clear', 'view:clear', 'cache:clear', 'package:discover --ansi'];
        foreach ($cmds as $cmd) {
            try {
                if (str_contains($cmd, ' ')) {
                    [$name, $args] = explode(' ', $cmd, 2);
                    Artisan::call($name);
                } else {
                    Artisan::call($cmd);
                }
            } catch (\Throwable $e) {
                $this->appendLog($log, "Artisan {$cmd} 警告：" . $e->getMessage());
            }
        }
        $this->setPhase($log, self::PHASE_CLEARING_CACHE, 99);
    }

    protected function resolveProjectRoot(): ?string
    {
        try {
            return rtrim(base_path(), DIRECTORY_SEPARATOR . '/');
        } catch (\Throwable $e) {
            return null;
        }
    }

    // ============================================================
    // 工具
    // ============================================================
    protected function setPhase(UpdateLog $log, string $phase, int $percent): void
    {
        UpdateLog::where('id', $log->id)->update([
            'phase' => $phase,
            'progress_percent' => $percent,
        ]);
        $log->phase = $phase;
        $log->progress_percent = $percent;
    }

    protected function appendLog(UpdateLog $log, string $line): void
    {
        $stamp = '[' . now()->toDateTimeString() . '] ';
        $current = UpdateLog::where('id', $log->id)->value('log');
        if ($current === null) return;
        $next = (string) $current . $stamp . $line . "\n";
        UpdateLog::where('id', $log->id)->update(['log' => $next]);
    }

    protected function formatBytes(int $bytes): string
    {
        if ($bytes < 1024) return $bytes . ' B';
        if ($bytes < 1024 * 1024) return number_format($bytes / 1024, 2) . ' KB';
        if ($bytes < 1024 * 1024 * 1024) return number_format($bytes / 1024 / 1024, 2) . ' MB';
        return number_format($bytes / 1024 / 1024 / 1024, 2) . ' GB';
    }

    // ============================================================
    // 数据表完整性检查 / 修复
    // ============================================================

    public function checkDatabase(): array
    {
        $files = glob(database_path('migrations/*.php')) ?: [];
        sort($files);
        $allMigrations = array_map(fn ($f) => pathinfo($f, PATHINFO_FILENAME), $files);

        $ran = [];
        try {
            if (Schema::hasTable('migrations')) {
                $ran = DB::table('migrations')->pluck('migration')->all();
            }
        } catch (\Throwable $e) {
            throw new \RuntimeException('无法访问 migrations 表：' . $e->getMessage());
        }

        $ranSet = array_flip($ran);
        $pending = [];
        foreach ($allMigrations as $m) {
            if (!isset($ranSet[$m])) $pending[] = $m;
        }

        $created = [];
        $dropped = [];
        foreach ($files as $file) {
            $content = @file_get_contents($file);
            if ($content === false) continue;
            $upSrc = $this->extractUpSection($content);
            if (preg_match_all('/Schema::create\s*\(\s*[\'"]([A-Za-z0-9_]+)[\'"]/', $upSrc, $m)) {
                foreach ($m[1] as $t) $created[$t] = true;
            }
            if (preg_match_all('/Schema::dropIfExists\s*\(\s*[\'"]([A-Za-z0-9_]+)[\'"]/', $upSrc, $m)) {
                foreach ($m[1] as $t) $dropped[$t] = true;
            }
        }
        $expected = array_diff_key($created, $dropped);
        foreach (self::FRAMEWORK_TABLES as $t) $expected[$t] = true;
        $expectedTables = array_keys($expected);
        sort($expectedTables);

        $missingTables = [];
        foreach ($expectedTables as $t) {
            try {
                if (!Schema::hasTable($t)) $missingTables[] = $t;
            } catch (\Throwable $e) {
                // 个别表查询异常不打断整体检查
            }
        }

        $extraTables = [];
        try {
            $dbName = (string) config('database.connections.' . config('database.default') . '.database');
            if ($dbName !== '') {
                $rows = DB::select('SHOW TABLES');
                $actualTables = [];
                foreach ($rows as $row) {
                    foreach ((array) $row as $v) { $actualTables[] = (string) $v; break; }
                }
                $expectedSet = array_flip($expectedTables);
                foreach ($actualTables as $t) {
                    if (!isset($expectedSet[$t])) $extraTables[] = $t;
                }
                sort($extraTables);
            }
        } catch (\Throwable $e) {
            // 非 MySQL 或权限不足，忽略
        }

        $ok = empty($pending) && empty($missingTables);

        return [
            'ok' => $ok,
            'migrations_total' => count($allMigrations),
            'migrations_ran' => count($ran),
            'pending_migrations' => array_values($pending),
            'expected_tables' => $expectedTables,
            'missing_tables' => array_values($missingTables),
            'extra_tables' => $extraTables,
            'checked_at' => now()->toDateTimeString(),
        ];
    }

    protected function extractUpSection(string $content): string
    {
        $pos = strpos($content, 'function down');
        return $pos === false ? $content : substr($content, 0, $pos);
    }

    public function repairDatabase(): array
    {
        if ($this->runningLog()) {
            throw new \RuntimeException('升级任务正在执行中，请等待完成再进行数据表修复');
        }

        $before = $this->checkDatabase();

        $output = '';
        $success = true;
        $error = '';
        try {
            @set_time_limit(300);
            $code = Artisan::call('migrate', ['--force' => true]);
            $output = trim((string) Artisan::output());
            if ($code !== 0) {
                $success = false;
                $error = "migrate 退出码 {$code}";
            }
        } catch (\Throwable $e) {
            $success = false;
            $error = $e->getMessage();
            Log::error('[UpdateService] repairDatabase failed', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
        }

        $after = $this->checkDatabase();

        return [
            'success' => $success,
            'error' => $error,
            'output' => $output,
            'before' => $before,
            'after' => $after,
        ];
    }

    // ============================================================
    // 历代版本更新记录（聚合远端 releases.json）
    // ============================================================

    public function releases(): array
    {
        $url = (string) config('version.releases_url');
        $current = $this->currentVersion();

        if ($url === '') {
            return [
                'source' => 'local',
                'updated_at' => '',
                'current' => $current,
                'releases' => [],
                'error' => '未配置 releases_url',
            ];
        }

        try {
            $resp = Http::timeout((int) config('version.http_timeout', 30))
                ->withOptions(['verify' => true])
                ->get($url);
        } catch (\Throwable $e) {
            return [
                'source' => 'remote',
                'updated_at' => '',
                'current' => $current,
                'releases' => [],
                'error' => '请求远端 releases.json 失败：' . $e->getMessage(),
            ];
        }

        if (!$resp->successful()) {
            return [
                'source' => 'remote',
                'updated_at' => '',
                'current' => $current,
                'releases' => [],
                'error' => "远端 releases.json 返回 HTTP {$resp->status()}",
            ];
        }

        $data = $resp->json();
        if (!is_array($data) || !isset($data['releases']) || !is_array($data['releases'])) {
            return [
                'source' => 'remote',
                'updated_at' => '',
                'current' => $current,
                'releases' => [],
                'error' => '远端 releases.json 格式不合法（缺少 releases 数组）',
            ];
        }

        $releases = [];
        foreach ($data['releases'] as $r) {
            if (!is_array($r) || empty($r['version'])) continue;
            $releases[] = [
                'version' => (string) $r['version'],
                'released_at' => (string) ($r['released_at'] ?? ''),
                'breaking' => (bool) ($r['breaking'] ?? false),
                'changelog' => array_values((array) ($r['changelog'] ?? [])),
                'size' => (int) ($r['size'] ?? 0),
                'sha256' => (string) ($r['sha256'] ?? ''),
                'zip_url' => (string) ($r['zip_url'] ?? ''),
            ];
        }

        usort($releases, fn ($a, $b) => $this->compareVersion($b['version'], $a['version']));

        return [
            'source' => 'remote',
            'updated_at' => (string) ($data['updated_at'] ?? ''),
            'current' => $current,
            'releases' => $releases,
            'error' => '',
        ];
    }
}
