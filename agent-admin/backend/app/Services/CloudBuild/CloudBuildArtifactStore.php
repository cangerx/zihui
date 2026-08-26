<?php

namespace App\Services\CloudBuild;

use InvalidArgumentException;

/**
 * 每个 build_id 一个目录。禁止路径穿越。
 */
class CloudBuildArtifactStore
{
    public function __construct(private string $root)
    {
        $this->root = rtrim($root, DIRECTORY_SEPARATOR);
    }

    public static function fromSettings(CloudBuildExecutionSettings $settings): self
    {
        $root = $settings->storageRoot;
        if ($root === '') {
            $root = function_exists('storage_path')
                ? storage_path('app/cloud-build-artifacts')
                : sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'cloud-build-artifacts';
        }
        return new self($root);
    }

    public function root(): string
    {
        return $this->root;
    }

    public function buildDir(string $buildId): string
    {
        return $this->root . DIRECTORY_SEPARATOR . $this->safeBuildId($buildId);
    }

    public function finalPath(string $buildId, string $filename): string
    {
        return $this->buildDir($buildId) . DIRECTORY_SEPARATOR . $this->safeFilename($filename);
    }

    public function partPath(string $buildId, string $filename): string
    {
        return $this->finalPath($buildId, $filename) . '.part';
    }

    public function ensureBuildDir(string $buildId): string
    {
        $dir = $this->buildDir($buildId);
        if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
            throw new InvalidArgumentException('cannot create artifact dir');
        }
        return $dir;
    }

    public function atomicPlace(string $partPath, string $finalPath): bool
    {
        if (!is_file($partPath)) {
            return false;
        }
        if (is_file($finalPath)) {
            @unlink($finalPath);
        }
        return @rename($partPath, $finalPath);
    }

    public function purgeBuild(string $buildId): int
    {
        $dir = $this->buildDir($buildId);
        if (!is_dir($dir)) {
            return 0;
        }
        $deleted = 0;
        foreach (scandir($dir) ?: [] as $name) {
            if ($name === '.' || $name === '..') {
                continue;
            }
            $path = $dir . DIRECTORY_SEPARATOR . $name;
            if (is_file($path) && @unlink($path)) {
                $deleted++;
            }
        }
        @rmdir($dir);
        return $deleted;
    }

    /**
     * @return list<string> build_id 目录名
     */
    public function directoryBuildIds(): array
    {
        if (!is_dir($this->root)) {
            return [];
        }
        $ids = [];
        foreach (scandir($this->root) ?: [] as $name) {
            if ($name === '.' || $name === '..') {
                continue;
            }
            if (is_dir($this->root . DIRECTORY_SEPARATOR . $name) && $this->isBuildId($name)) {
                $ids[] = $name;
            }
        }
        return $ids;
    }

    public function safeBuildId(string $buildId): string
    {
        if (!$this->isBuildId($buildId)) {
            throw new InvalidArgumentException('invalid build_id');
        }
        return strtolower($buildId);
    }

    public function safeFilename(string $filename): string
    {
        $base = basename(str_replace('\\', '/', $filename));
        if ($base === '' || $base === '.' || $base === '..' || str_contains($base, '..')) {
            throw new InvalidArgumentException('invalid filename');
        }
        return $base;
    }

    public function isBuildId(string $buildId): bool
    {
        return (bool) preg_match('/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/', $buildId);
    }
}
