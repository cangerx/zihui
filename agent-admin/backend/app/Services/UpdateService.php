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
     * 框架 / 官方包内置的表（不在 database/migrations/*.php 但属于“应该存在”）
     * - migrations：Laravel 迷踪迁移状态表（框架自建）
     * - personal_access_tokens：Laravel Sanctum 包的 API token 表（vendor migration）
     * 加入后，数据表检查页 UI 不会再把它们归到“额外表”造成误解。
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
     *
     * 返回字段：
     *   ok          bool   是否全部可写
     *   base_path   string 项目根绝对路径
     *   php_user    string 当前 PHP 进程用户名
     *   message     string 给用户看的友好描述
     *   chown_cmd   string Linux 下建议的 chown 修复命令（在 Windows 下为空）
     *   bad_paths   array  不可写的子目录列表
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
            // 安全修复脚本：
            //   1) 代码目录 chown 给 www 但权限 750，避免 others 看到源码
            //   2) public 保持 755 给 Nginx 读静态资源
            //   3) .env 单独 640 由 root 持有写权限，避免密钥泄漏
            //   4) storage / bootstrap/cache 按 Laravel 规范 775
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

    /**
     * 拉取远端 version.json 并对比本地版本
     *
     * 返回数组字段：current / latest / released_at / upgradable / breaking
     * / zip_url / sha256 / size / changelog / min_upgradable_from
     *
     * @return array
     * @throws \RuntimeException 网络失败 / JSON 格式错误 / 字段缺失
     */
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

        $zipUrl = trim((string) $data['zip_url']);
        if ($zipUrl === '') {
            throw new \RuntimeException('更新源尚未提供安装包地址。请先在授权后台「云控发版」上传 zip 并设为当前。');
        }

        // 安全：zip_url 必须在白名单域名内
        $allowed = (array) config('version.allowed_zip_hosts', []);
        $host = parse_url($zipUrl, PHP_URL_HOST);
        if (!is_string($host) || $host === '') {
            throw new \RuntimeException('zip_url 不是可解析的 http(s) 地址');
        }
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

    /** 当前正在进行的升级（最多一个）
     *
     * 僵尸回收：如果 running 状态记录的 updated_at 超过 1 小时无更新，
     * 视为进程崩溃，自动标记为 failed 并返回 null（不再阻塞新升级）。
     */
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
            // 锁文件存在，但要检查是不是僵尸锁（>1 小时未更新）
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

    /**
     * 启动一次升级，立即创建 update_logs 记录并返回 logId，
     * 实际执行通过 fastcgi_finish_request 异步进行（如不可用则同步）。
     */
    public function apply(int $operatorId, string $operatorName): UpdateLog
    {
        // 预检：写权限（在获锁前就判断，避免浪费备份时间）
        $writable = $this->probeWritable();
        if (!$writable['ok']) {
            throw new \RuntimeException(
                $writable['message'] . '（请在「在线更新」页面查看完整修复命令）'
            );
        }

        // 互斥
        if ($this->runningLog()) {
            throw new \RuntimeException('已有升级任务正在执行中，请等待完成');
        }
        if (!$this->acquireLock()) {
            throw new \RuntimeException('获取升级锁失败，可能有其他升级任务正在执行');
        }

        // 锁已拿到，后续任何异常都必须释放锁
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

        // 立刻关闭客户端连接，后台继续执行（run() 内部会在 finally 里释放锁）
        $this->detachAndRun($log->id);

        return $log->fresh();
    }

    /**
     * 关闭 HTTP 连接并在后台继续执行升级流程
     */
    protected function detachAndRun(int $logId): void
    {
        // 输出空响应，flush
        if (function_exists('fastcgi_finish_request')) {
            // 仅 PHP-FPM 可用：返回空响应给客户端，断开连接，但 PHP 进程继续运行
            // Controller 调用完 apply() 后会立即返回 JSON，
            // detachAndRun 在 controller 返回响应之前调用 fastcgi_finish_request
            // 实际是通过 register_shutdown_function 在 response 发送后才执行
            register_shutdown_function(function () use ($logId) {
                @ignore_user_abort(true);
                @set_time_limit(0);
                fastcgi_finish_request();
                $this->run($logId);
            });
            return;
        }

        // 退化：同步执行（开发环境 php artisan serve）
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

            // 完成
            $this->setPhase($log, self::PHASE_COMPLETED, 100);
            $duration = (int) (microtime(true) - $startTs);
            UpdateLog::where('id', $log->id)->update([
                'status' => UpdateLog::STATUS_SUCCESS,
                'finished_at' => now(),
                'duration_seconds' => $duration,
            ]);
            $this->appendLog($log, "升级成功，耗时 {$duration}s");

            // 清理 zip 临时文件
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
            // 失败时也清理 zip 临时文件，避免残留
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

        // 用 cURL 流式下载，便于估算进度
        $fp = @fopen($zipPath, 'w');
        if (!$fp) throw new \RuntimeException("无法创建临时文件 {$zipPath}");

        $ch = curl_init($log->zip_url);
        curl_setopt_array($ch, [
            CURLOPT_FILE => $fp,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => (int) config('version.download_timeout', 600),
            CURLOPT_CONNECTTIMEOUT => 30,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_USERAGENT => 'AgentAdmin-Updater/1.0',
            CURLOPT_NOPROGRESS => false,
            CURLOPT_PROGRESSFUNCTION => function ($_, $dlTotal, $dlNow) use ($log) {
                if ($dlTotal <= 0) return 0;
                static $lastPct = 0;
                $pct = (int) min(40, 5 + ($dlNow / $dlTotal) * 35);
                // 节流，每变化 2% 才写库
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

        // 备份关键代码目录
        $codeBackup = $backupDir . '/code.zip';
        $zip = new ZipArchive();
        if ($zip->open($codeBackup, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new \RuntimeException("无法创建备份 zip：{$codeBackup}");
        }

        $base = base_path();
        // 仅备份升级会覆盖的核心目录（够回滚用，但不至于太大）
        $backupTargets = ['app', 'config', 'database/migrations', 'routes', 'resources', 'public/admin'];
        foreach ($backupTargets as $rel) {
            $abs = $base . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $rel);
            if (!is_dir($abs)) continue;
            $this->addDirToZip($zip, $abs, $rel);
        }
        // 备份 composer.json / composer.lock
        foreach (['composer.json', 'composer.lock'] as $f) {
            $abs = $base . DIRECTORY_SEPARATOR . $f;
            if (is_file($abs)) $zip->addFile($abs, $f);
        }
        $zip->close();
        $this->appendLog($log, '代码已备份至 ' . str_replace($base, '', $codeBackup));

        // 备份数据库（如果是 mysql 且能找到 mysqldump）
        try {
            $this->backupMysql($backupDir, $log);
        } catch (\Throwable $e) {
            $this->appendLog($log, '数据库备份跳过：' . $e->getMessage());
        }

        // 升级备份保留策略：仅保留最近 N 份（默认 5），避免 storage/app/backups/ 逐代累积占满磁盘。
        // 完全依赖名称是 `Y-m-d-His` 字典序排序。失败不抛异常，仅记日志。
        try {
            $this->pruneOldBackups($log, (int) config('version.backup_keep_count', 5));
        } catch (\Throwable $e) {
            $this->appendLog($log, '旧备份清理跳过：' . $e->getMessage());
        }

        $this->setPhase($log, self::PHASE_BACKING_UP, 60);
        return $backupDir;
    }

    /**
     * 保留 storage/app/backups/ 最近 $keep 份升级备份，超出部分递归删除。
     * 备份目录名为 `Y-m-d-His`，字典序与时间顺序一致，可直接 sort()。
     * 只处理名称严格匹配该格式的目录，避免误删人为创建的其他目录。
     */
    protected function pruneOldBackups(UpdateLog $log, int $keep): void
    {
        $keep = max(1, $keep); // 底线保留1份，避免误配置删掉全部
        $root = storage_path('app/backups');
        if (!is_dir($root)) return;

        $entries = @scandir($root) ?: [];
        $dirs = [];
        foreach ($entries as $name) {
            if ($name === '.' || $name === '..') continue;
            // 严格匹配 Y-m-d-His 格式（30 个字符以上的路径也包括，但主要是 17 字符）
            if (!preg_match('/^\d{4}-\d{2}-\d{2}-\d{6}$/', $name)) continue;
            $abs = $root . DIRECTORY_SEPARATOR . $name;
            if (is_dir($abs)) $dirs[] = $name;
        }
        if (count($dirs) <= $keep) return;

        sort($dirs); // 升序：最早的在前
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

    /**
     * 递归删除目录，失败返回 false。不跟随符号链接。
     */
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

        // 用 proc_open 注入环境变量，避免 -p 暴露密码
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
        // PATH 查找
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

            // 安全：跳过零碎和绝对路径
            if ($name === '' || $name[0] === '/' || str_contains($name, '..')) {
                $skipped++;
                continue;
            }
            // 跳过保护路径
            if ($this->isProtectedPath($name)) {
                $skipped++;
                continue;
            }

            $target = $base . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $name);

            // 目录条目
            if (str_ends_with($name, '/')) {
                @mkdir($target, 0755, true);
                continue;
            }

            // 创建父目录
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

            // 节流更新进度
            if ($extracted % 50 === 0 || $i === $total - 1) {
                $pct = (int) min(85, 62 + ($i / $total) * 23);
                UpdateLog::where('id', $log->id)->update(['progress_percent' => $pct]);
            }
        }
        $zip->close();
        $this->appendLog($log, "解压完成：{$extracted} 文件" . ($skipped > 0 ? "（跳过 {$skipped} 项保护文件）" : ''));

        // 确保 bootstrap/cache 目录存在
        $cacheDir = $base . '/bootstrap/cache';
        if (!is_dir($cacheDir)) @mkdir($cacheDir, 0755, true);

        // 关键修复：解压完立即清理 bootstrap/cache 下的编译缓存文件。
        // 旧版本可能在缓存里注册了已被 --no-dev 剥离的 ServiceProvider（如 spatie/laravel-ignition），
        // 不清的话下一次请求 Laravel 启动时会因 ClassNotFound 抛 500。
        // 用文件系统直接 unlink，不依赖 Artisan（此时 vendor 已被替换，Artisan 自身可能跑不起来）。
        $this->purgeBootstrapCache($cacheDir, $log);

        $this->setPhase($log, self::PHASE_EXTRACTING, 85);
    }

    /**
     * 清空 bootstrap/cache 下的 Laravel 编译产物文件，保留 .gitignore 占位。
     * 失败不抛异常（升级流程不应该被这里阻塞），仅写日志。
     */
    protected function purgeBootstrapCache(string $cacheDir, ?UpdateLog $log = null): void
    {
        if (!is_dir($cacheDir)) return;
        $patterns = [
            'packages.php',     // 自动 discover 的 ServiceProvider 列表（最易引用 dev 包）
            'services.php',     // \Illuminate\Foundation\AliasLoader 缓存
            'config.php',       // config:cache 产物
            'compiled.php',     // optimize 产物
            'routes-v7.php',    // route:cache 产物（Laravel 9）
            'routes-v6.php',    // route:cache 产物（Laravel 8 兼容）
            'events.php',       // event:cache 产物
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
        $result = $this->migrateWithRetry();
        $suffix = $result['attempts'] > 1 ? "（重试 {$result['attempts']} 次）" : '';
        $this->appendLog($log, "migrate 输出{$suffix}：\n" . $result['output']);
        if (!$result['ok']) {
            throw new \RuntimeException('migrate 执行失败：' . $result['error']);
        }
        $this->setPhase($log, self::PHASE_MIGRATING, 95);
    }

    /**
     * 执行 migrate --force，对 MySQL 1615「Prepared statement needs to be re-prepared」
     * 这类瞬时错误自动重试。
     *
     * 背景：大跨度升级（如 1.1.1 → 最新）会一次性跑大量 migration，期间海量 DDL 会冲刷
     * MySQL 的 table_definition_cache，导致后续依赖某表 metadata 的 prepared 语句在
     * re-prepare 时偶发 1615。该错误是瞬时的——前序 migration 已 Ran，断连重建后从失败点
     * 幂等续跑即可成功。低配 / 共享主机 / 特定 MySQL 版本更易触发。
     *
     * @return array{ok:bool, code:int, output:string, attempts:int, error:string}
     */
    protected function migrateWithRetry(int $maxAttempts = 3): array
    {
        $attempt = 0;
        $output = '';
        while ($attempt < $maxAttempts) {
            $attempt++;
            try {
                $code = Artisan::call('migrate', ['--force' => true]);
                $output = trim((string) Artisan::output());
                if ($code === 0) {
                    return ['ok' => true, 'code' => 0, 'output' => $output, 'attempts' => $attempt, 'error' => ''];
                }
                // 退出码非 0 但未抛异常：非 1615 场景，不重试
                return ['ok' => false, 'code' => $code, 'output' => $output, 'attempts' => $attempt, 'error' => "migrate 退出码 {$code}"];
            } catch (\Throwable $e) {
                $output = trim((string) Artisan::output());
                $message = $e->getMessage();
                if ($attempt < $maxAttempts && $this->isRepreparableError($message)) {
                    Log::warning('[UpdateService] migrate 遇到可重试错误(MySQL 1615)，准备重连重试', [
                        'attempt' => $attempt,
                        'error' => $message,
                    ]);
                    // 断开重连，丢弃失效的 PDO prepared statement 缓存，让 re-prepare 在新连接上成功
                    try { DB::reconnect(); } catch (\Throwable $ignore) {}
                    usleep(800000); // 0.8s 退避
                    continue;
                }
                return ['ok' => false, 'code' => -1, 'output' => $output, 'attempts' => $attempt, 'error' => $message];
            }
        }
        return ['ok' => false, 'code' => -1, 'output' => $output, 'attempts' => $attempt, 'error' => 'migrate 重试次数耗尽'];
    }

    /**
     * 是否为 MySQL 1615「Prepared statement needs to be re-prepared」这类可重试瞬时错误。
     */
    protected function isRepreparableError(string $message): bool
    {
        return str_contains($message, '1615')
            || stripos($message, 'needs to be re-prepared') !== false;
    }

    // ============================================================
    // Phase 6: 清缓存
    // ============================================================
    protected function phaseClearCache(UpdateLog $log): void
    {
        $this->setPhase($log, self::PHASE_CLEARING_CACHE, 96);

        // 双保险：再次用文件系统清 bootstrap/cache 编译产物，避免新代码引用已剥离的 dev 包 ServiceProvider。
        $base = $this->resolveProjectRoot();
        if ($base) $this->purgeBootstrapCache($base . '/bootstrap/cache', $log);

        // clear-compiled 单独跑：清 services.php（Laravel 9 起 services.php 由该命令管理）
        // package:discover 重建 packages.php（基于新 vendor 的 installed.json 自动发现）
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

    /**
     * 解析项目根目录（Laravel base_path），用于定位 bootstrap/cache。
     */
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
        // 只读 log 字段再追加写回，避免 $log->save() 覆盖其他字段
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

    /**
     * 扫描 database/migrations 文件，与 migrations 表、Schema::hasTable 对比，
     * 得出：
     *   - pending_migrations 未执行的 migration 文件
     *   - missing_tables     Schema::create 声明但实际数据库缺失的表
     * 全部为空 => ok=true
     *
     * @return array
     */
    public function checkDatabase(): array
    {
        $files = glob(database_path('migrations/*.php')) ?: [];
        sort($files);
        $allMigrations = array_map(fn ($f) => pathinfo($f, PATHINFO_FILENAME), $files);

        // 已执行
        $ran = [];
        try {
            if (Schema::hasTable('migrations')) {
                $ran = DB::table('migrations')->pluck('migration')->all();
            }
        } catch (\Throwable $e) {
            // 数据库都连不上，直接抛
            throw new \RuntimeException('无法访问 migrations 表：' . $e->getMessage());
        }

        $ranSet = array_flip($ran);
        $pending = [];
        foreach ($allMigrations as $m) {
            if (!isset($ranSet[$m])) $pending[] = $m;
        }

        // 静态扫 migration 文件推断"期望存在的表"。
        // 关键：Laravel migration 的 down() 方法通常会用 Schema::dropIfExists 回滚 up() 里的 create，
        // 这是“回滚”意图不是“废弃”意图。只有独立 migration 的 up() 里的 dropIfExists
        // 才是真正“废弃该表”。所以按 `function down` 切分，只扫 up() 部分。
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
        // 期望存在 = 曾被 create 且不存在独立 migration 取消创建。
        // 加上框架/官方包内置表（它们不在本地 migrations 目录里，但是应当存在的）。
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

        // 实际存在但不在 expected 清单里的表（静态扫描不完整或手工建表），仅供展示
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

    /**
     * 提取 migration 文件中 up() 方法之前的部分作为 up() 代码体。
     * Laravel 9 anonymous class migration 的结构：
     *   public function up(): void { ... }
     *   public function down(): void { ... }
     * 简单按 "function down" 字符串切分，之前部分包含 up() + 外层代码。
     * 没有 down() 的文件返回全文（选件实际都会有 down，其他 helper 文件不受影响）。
     */
    protected function extractUpSection(string $content): string
    {
        $pos = strpos($content, 'function down');
        return $pos === false ? $content : substr($content, 0, $pos);
    }

    /**
     * 一键执行 migrate --force 修复缺失的 migration，
     * 执行前后各跑一次 checkDatabase 做差分。
     *
     * 返回字段：success / error / output / before / after
     *
     * @return array
     */
    public function repairDatabase(): array
    {
        // 升级中不能同时修复，避免 migrations 表竞争
        if ($this->runningLog()) {
            throw new \RuntimeException('升级任务正在执行中，请等待完成再进行数据表修复');
        }

        $before = $this->checkDatabase();

        $output = '';
        $success = true;
        $error = '';
        try {
            @set_time_limit(300);
            $result = $this->migrateWithRetry();
            $output = $result['output'];
            if (!$result['ok']) {
                $success = false;
                $error = $result['error'];
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

    /**
     * 拉取远端 releases.json，返回历代版本 changelog 列表。
     *
     * 约定 releases.json 结构：
     *   {
     *     "updated_at": "2026-05-04T03:00:00+08:00",
     *     "releases": [
     *       { "version": "1.0.3", "released_at": "...", "breaking": false,
     *         "changelog": ["..."], "size": 123, "sha256": "...", "zip_url": "..." },
     *       ...
     *     ]
     *   }
     *
     * 若远端 releases.json 不可用，降级：仅返回本地当前版本 changelog 占位。
     *
     * @return array
     */
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

        // 规范化每条记录
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

        // 按版本号倒序（从新到旧）
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
