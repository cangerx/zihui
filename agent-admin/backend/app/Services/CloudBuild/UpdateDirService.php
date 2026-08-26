<?php

namespace App\Services\CloudBuild;

use Illuminate\Support\Facades\Log;

class UpdateDirService
{
    /**
     * Single-file atomic replace (kept for back-compat with cloud-build:pull v1).
     */
    public function atomicReplace(string $tmpPath, string $platform, string $filename): array
    {
        $r = $this->atomicReplaceMany([['tmp_path' => $tmpPath, 'filename' => $filename]], $platform);
        if (!$r['ok']) {
            return ['ok' => false, 'error' => $r['error'] ?? 'unknown'];
        }
        $first = $r['placed'][0];
        return [
            'ok' => true,
            'stored_path' => $first['stored_path'],
            'absolute_path' => $first['absolute_path'],
            'public_url_path' => '/' . $first['stored_path'],
        ];
    }

    /**
     * Multi-file atomic replace. All files staged first; if all stages succeed,
     * all renamed to final atomic in a tight loop. If any stage fails the whole
     * batch aborts and stages are cleaned up.
     *
     * 1.2.6 起：落盘统一到 public/updates/ 根目录（而非 public/updates/{platform}/ 子目录），
     * 与 electron-updater 默认约定一致（latest.yml / latest-mac.yml 同名不同平台用，
     * .exe / .dmg / .zip 平台后缀天然不冲突）。已安装的桌面端 publish.url 指向 /updates/ 根，
     * 升级到 1.2.6 后自动找到正确的 latest.yml，无需重新打包桌面端。
     *
     * 老的 public/updates/win|mac/ 子目录由配套 migration 迁移到根并删除空子目录。
     *
     * @param list<array{tmp_path:string,filename:string}> $files
     * @return array{ok:bool, placed?:list<array{filename:string,stored_path:string,absolute_path:string}>, error?:string}
     */
    public function atomicReplaceMany(array $files, string $platform, string $targetSubdir = ''): array
    {
        if (!in_array($platform, ['win', 'mac'], true)) {
            return ['ok' => false, 'error' => 'invalid_platform'];
        }
        if (empty($files)) {
            return ['ok' => false, 'error' => 'empty_files'];
        }

        $targetSubdir = $this->normalizeTargetSubdir($targetSubdir);
        if ($targetSubdir === null) {
            return ['ok' => false, 'error' => 'invalid_target_subdir'];
        }

        $publicUpdates = $this->updatesBaseDir();
        if ($targetSubdir !== '') {
            $publicUpdates .= DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $targetSubdir);
        }
        if (!is_dir($publicUpdates) && !mkdir($publicUpdates, 0755, true) && !is_dir($publicUpdates)) {
            return ['ok' => false, 'error' => 'mkdir_failed', 'path' => $publicUpdates];
        }

        // Phase 1: validate inputs + copy each tmp -> staging
        $stages = []; // [{tmp_path, staging_path, final_path, filename}]
        foreach ($files as $f) {
            $tmpPath = $f['tmp_path'] ?? '';
            $filename = $f['filename'] ?? '';
            if (!is_file($tmpPath)) {
                $this->cleanupStages($stages);
                return ['ok' => false, 'error' => 'tmp_not_found', 'filename' => $filename];
            }
            $safeFilename = basename($filename);
            if ($safeFilename === '' || str_contains($safeFilename, '..')) {
                $this->cleanupStages($stages);
                return ['ok' => false, 'error' => 'invalid_filename', 'filename' => $filename];
            }
            $finalPath = $publicUpdates . DIRECTORY_SEPARATOR . $safeFilename;
            $stagingPath = $finalPath . '.staging';

            if (!@copy($tmpPath, $stagingPath)) {
                $this->cleanupStages($stages);
                return ['ok' => false, 'error' => 'copy_failed', 'filename' => $safeFilename];
            }
            $stages[] = [
                'tmp_path' => $tmpPath,
                'staging_path' => $stagingPath,
                'final_path' => $finalPath,
                'filename' => $safeFilename,
            ];
        }

        // Phase 2: atomic rename (tight loop)
        $placed = [];
        foreach ($stages as $s) {
            if (!@rename($s['staging_path'], $s['final_path'])) {
                if (file_exists($s['final_path'])) {
                    @unlink($s['final_path']);
                }
                if (!@rename($s['staging_path'], $s['final_path'])) {
                    Log::error('[UpdateDir] rename_failed', ['filename' => $s['filename']]);
                    @unlink($s['staging_path']);
                    // Other already-renamed files left in place (best-effort partial success not unwound)
                    return ['ok' => false, 'error' => 'rename_failed', 'filename' => $s['filename']];
                }
            }
            $placed[] = [
                'filename' => $s['filename'],
                'stored_path' => 'updates/' . ($targetSubdir !== '' ? $targetSubdir . '/' : '') . $s['filename'],
                'absolute_path' => $s['final_path'],
            ];
            @unlink($s['tmp_path']);
        }

        return ['ok' => true, 'placed' => $placed];
    }

    public function updatesBaseDir(): string
    {
        $configured = config('cloudbuild.updates_dir');
        if ($configured) {
            return rtrim($configured, '/\\');
        }
        return public_path('updates');
    }

    /**
     * 1.2.6 起：根目录布局下，按平台主文件后缀（.exe / .dmg / .zip）识别需要保留的版本，
     * 同时清理对应的 .blockmap 副件。latest.yml / latest-mac.yml 单文件，由每次落盘
     * 直接覆写不参与剪枝。
     */
    public function pruneOld(string $platform, int $keepCount = 3, string $targetSubdir = ''): int
    {
        $base = $this->updatesBaseDir();
        $targetSubdir = $this->normalizeTargetSubdir($targetSubdir);
        if ($targetSubdir === null) return 0;
        if ($targetSubdir !== '') {
            $base .= DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $targetSubdir);
        }
        if (!is_dir($base)) return 0;

        // mac 自 0.6.0 起切到 .zip（electron-updater 只认 zip），但 OSS 上可能仍有遗留 .dmg；
        // 两者都纳入 mac primary 池一起按 mtime 排序剪枝，等历史 .dmg 自然滚出 keepCount 后被清掉。
        $primaryExts = $platform === 'mac' ? ['.dmg', '.zip'] : ['.exe'];

        // 收集根目录下所有该平台的主文件（installer），按 mtime 倒排
        $primaries = [];
        foreach (scandir($base) ?: [] as $f) {
            if ($f === '.' || $f === '..') continue;
            $full = $base . DIRECTORY_SEPARATOR . $f;
            if (!is_file($full)) continue;
            $lower = strtolower($f);
            $matched = false;
            foreach ($primaryExts as $ext) {
                if (str_ends_with($lower, $ext)) { $matched = true; break; }
            }
            if (!$matched) continue;
            $primaries[$full] = filemtime($full);
        }
        arsort($primaries);

        $i = 0;
        $removed = 0;
        foreach ($primaries as $path => $_) {
            $i++;
            if ($i <= $keepCount) continue;
            // 主文件 + 同名 blockmap 一起清
            $blockmap = $path . '.blockmap';
            if (@unlink($path)) {
                $removed++;
            } else {
                Log::warning('[UpdateDir] prune unlink failed', ['path' => $path]);
            }
            if (file_exists($blockmap)) {
                @unlink($blockmap);
            }
        }
        return $removed;
    }

    private function cleanupStages(array $stages): void
    {
        foreach ($stages as $s) {
            if (isset($s['staging_path'])) @unlink($s['staging_path']);
        }
    }

    private function normalizeTargetSubdir(string $subdir): ?string
    {
        $subdir = trim(str_replace('\\', '/', $subdir), '/');
        if ($subdir === '') return '';
        if (str_contains($subdir, '..') || preg_match('#/{2,}#', $subdir)) return null;
        if (!preg_match('#^[A-Za-z0-9._/-]+$#', $subdir)) return null;
        return $subdir;
    }
}
