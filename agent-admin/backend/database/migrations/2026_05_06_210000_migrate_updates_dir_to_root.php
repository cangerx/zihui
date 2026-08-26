<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * 1.2.6: 把 public/updates/win|mac/ 子目录下的存量更新文件迁移到 public/updates/ 根目录。
 *
 * 背景：
 *   1.2.5 及更早版本 UpdateDirService::atomicReplaceMany() 把云打包落盘的 .exe / .dmg /
 *   latest.yml / *.blockmap 放在 public/updates/{win|mac}/ 子目录下，但已安装桌面端的
 *   electron-updater 默认从 publish.url 根（即 https://<domain>/updates/）拉 latest.yml，
 *   导致桌面端「检查更新」请求 /updates/latest.yml 走到 Laravel 兜底 → 500 + text/html。
 *
 * 1.2.6 起 UpdateDirService 改为统一落到根目录；本 migration 负责把存量子目录文件搬到根，
 * 并同步更新 cloud_builds.stored_path 字段，让升级即修复，无需手工干预。
 *
 * 兼容性：
 *   - 同时清理 1.2.6 升级前可能由运维手工创建的 symlink（指向 win/X 或 mac/X）
 *   - 目标根目录已存在同名文件且内容相同时（重复迁移）直接清理子目录副本
 *   - 目标根目录已存在同名文件但内容不同时（异常）保留根目录文件 + 记 warning，不强行覆盖
 *   - 子目录搬空后 rmdir 删除空目录；搬不动的文件保留在子目录里，不影响功能（已不会再写入）
 *
 * 幂等：多次跑无副作用（已迁移过的文件会被识别为重复并清理子目录残留）。
 * 跨平台：使用原生 PHP 文件 API，Windows / Linux 通用。
 */
return new class extends Migration {
    public function up(): void
    {
        $base = $this->updatesBaseDir();
        if (!is_dir($base)) {
            return; // 没装过云打包的站点，没有 public/updates 目录，直接跳过
        }

        $movedCount = 0;
        $skippedCount = 0;
        $cleanedSymlinks = 0;

        foreach (['win', 'mac'] as $platform) {
            $platformDir = $base . DIRECTORY_SEPARATOR . $platform;
            if (!is_dir($platformDir)) continue;

            foreach (scandir($platformDir) ?: [] as $f) {
                if ($f === '.' || $f === '..') continue;
                $src = $platformDir . DIRECTORY_SEPARATOR . $f;
                $dst = $base . DIRECTORY_SEPARATOR . $f;

                // 处理 1.2.6 升级前可能由运维手工创建的 symlink（指向 win/X 或 mac/X）：
                // 这种 symlink 等价于"已迁移"，直接删除占位 symlink，让后续 rename 写真实文件
                if (is_link($dst)) {
                    @unlink($dst);
                    $cleanedSymlinks++;
                }

                if (!is_file($src)) continue; // 跳过子目录里的目录 / 异常项

                if (file_exists($dst) && !is_link($dst)) {
                    // 目标已存在且非 symlink，避免覆盖
                    if (filesize($dst) === filesize($src)
                        && hash_file('sha256', $dst) === hash_file('sha256', $src)) {
                        // 相同内容（已经迁移过 / 重打包），删除子目录里的副本
                        @unlink($src);
                    } else {
                        Log::warning('[migrate updates root] dst exists differs, kept dst', [
                            'src' => $src,
                            'dst' => $dst,
                        ]);
                        $skippedCount++;
                    }
                    continue;
                }

                if (@rename($src, $dst)) {
                    $movedCount++;
                } else {
                    Log::warning('[migrate updates root] rename failed', [
                        'src' => $src,
                        'dst' => $dst,
                    ]);
                    $skippedCount++;
                }
            }

            // 子目录为空则删
            $remaining = array_diff(scandir($platformDir) ?: [], ['.', '..']);
            if (empty($remaining)) {
                @rmdir($platformDir);
            }
        }

        // 同步更新 cloud_builds.stored_path：updates/win/X.exe → updates/X.exe
        $dbUpdated = 0;
        if (Schema::hasTable('cloud_builds')) {
            $dbUpdated += DB::update("
                UPDATE cloud_builds
                SET stored_path = REPLACE(stored_path, 'updates/win/', 'updates/')
                WHERE stored_path LIKE 'updates/win/%'
            ");
            $dbUpdated += DB::update("
                UPDATE cloud_builds
                SET stored_path = REPLACE(stored_path, 'updates/mac/', 'updates/')
                WHERE stored_path LIKE 'updates/mac/%'
            ");
        }

        Log::info('[migrate updates root] done', [
            'moved_files' => $movedCount,
            'skipped' => $skippedCount,
            'cleaned_symlinks' => $cleanedSymlinks,
            'db_rows_updated' => $dbUpdated,
        ]);
    }

    public function down(): void
    {
        // 不可逆迁移：物理移动了文件且更新了 DB。
        // 真要回滚：从 storage/app/backups/{date}/ 里恢复 code.zip + database.sql，
        // 或把 win/mac 子目录手工建回 + 文件移回 + DB 反向 REPLACE。
    }

    /**
     * 与 UpdateDirService::updatesBaseDir() 等价：尊重 cloudbuild.updates_dir 配置覆盖，
     * 缺省为 public_path('updates')。
     */
    private function updatesBaseDir(): string
    {
        $configured = config('cloudbuild.updates_dir');
        if ($configured) {
            return rtrim((string) $configured, '/\\');
        }
        return public_path('updates');
    }
};
