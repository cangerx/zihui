<?php

namespace App\Services\SkillCatalog;

use ZipArchive;

class SkillPackageScanner
{
    public function __construct(
        private int $maxZipBytes = 8_000_000,
        private int $maxUncompressed = 20_000_000,
        private int $maxFiles = 80,
        private int $maxRatio = 100,
        private SkillManifestValidator $manifests = new SkillManifestValidator(),
    ) {
    }

    /**
     * @return array{ok:bool,error:?string,sha256:?string,manifest:?array,file_count:int,package_size:int}
     */
    public function scan(string $zipPath): array
    {
        if (!is_file($zipPath)) {
            return $this->fail('package_unsafe');
        }
        $size = filesize($zipPath);
        if ($size === false || $size < 22 || $size > $this->maxZipBytes) {
            return $this->fail('package_unsafe');
        }
        $zip = new ZipArchive();
        if ($zip->open($zipPath) !== true) {
            return $this->fail('package_unsafe');
        }
        try {
            if ($zip->numFiles < 2 || $zip->numFiles > $this->maxFiles) {
                return $this->fail('package_unsafe');
            }
            $names = [];
            $uncompressed = 0;
            $compressed = 0;
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $stat = $zip->statIndex($i);
                if (!is_array($stat)) {
                    return $this->fail('package_unsafe');
                }
                $name = str_replace('\\', '/', (string) ($stat['name'] ?? ''));
                if ($name === '' || str_starts_with($name, '/') || str_contains($name, '..') || str_contains($name, "\0")) {
                    return $this->fail('package_unsafe');
                }
                if (str_ends_with($name, '/')) {
                    continue;
                }
                $opsys = 0;
                $attr = 0;
                if ($zip->getExternalAttributesIndex($i, $opsys, $attr) && $opsys === ZipArchive::OPSYS_UNIX) {
                    $mode = ($attr >> 16) & 0xF000;
                    if ($mode === 0xA000) {
                        return $this->fail('package_unsafe');
                    }
                }
                $u = (int) ($stat['size'] ?? 0);
                $c = (int) ($stat['comp_size'] ?? 0);
                $uncompressed += $u;
                $compressed += max($c, 1);
                if ($u > 8_000_000) {
                    return $this->fail('package_unsafe');
                }
                $names[] = $name;
            }
            if ($uncompressed > $this->maxUncompressed) {
                return $this->fail('package_unsafe');
            }
            if ($compressed > 0 && ($uncompressed / $compressed) > $this->maxRatio) {
                return $this->fail('package_unsafe');
            }
            $json = $zip->getFromName('skill.json');
            $md = $zip->getFromName('SKILL.md');
            if (!is_string($json) || !is_string($md) || $md === '') {
                return $this->fail('manifest_invalid');
            }
            try {
                $manifest = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
            } catch (\Throwable $e) {
                return $this->fail('manifest_invalid');
            }
            $checked = $this->manifests->validate($manifest);
            if (!$checked['ok']) {
                return $this->fail((string) $checked['error']);
            }
            $declared = $checked['manifest']['files'];
            sort($declared);
            $actual = $names;
            sort($actual);
            if ($declared !== $actual) {
                return $this->fail('package_unsafe');
            }
            $sha256 = hash_file('sha256', $zipPath);
            return [
                'ok' => true,
                'error' => null,
                'sha256' => $sha256 === false ? null : $sha256,
                'manifest' => $checked['manifest'],
                'file_count' => count($names),
                'package_size' => $size,
            ];
        } finally {
            $zip->close();
        }
    }

    /**
     * @return array{ok:bool,error:string,sha256:null,manifest:null,file_count:int,package_size:int}
     */
    private function fail(string $error): array
    {
        return [
            'ok' => false,
            'error' => $error,
            'sha256' => null,
            'manifest' => null,
            'file_count' => 0,
            'package_size' => 0,
        ];
    }
}
