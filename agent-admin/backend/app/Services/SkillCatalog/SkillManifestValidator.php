<?php

namespace App\Services\SkillCatalog;

class SkillManifestValidator
{
    public const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i';

    /**
     * @param mixed $manifest
     * @return array{ok:bool,error:?string,manifest:?array}
     */
    public function validate(mixed $manifest): array
    {
        if (!is_array($manifest) || array_is_list($manifest)) {
            return $this->fail('manifest_invalid');
        }
        $allowed = [
            'schema_version', 'skill_id', 'version_id', 'slug', 'name', 'description',
            'version', 'entrypoint', 'files', 'permissions', 'minimum_client_version',
        ];
        foreach (array_keys($manifest) as $key) {
            if (!in_array($key, $allowed, true)) {
                return $this->fail('manifest_invalid');
            }
        }
        foreach (['schema_version', 'skill_id', 'version_id', 'slug', 'name', 'version', 'entrypoint', 'files', 'permissions', 'minimum_client_version'] as $req) {
            if (!array_key_exists($req, $manifest)) {
                return $this->fail('manifest_invalid');
            }
        }
        if (($manifest['schema_version'] ?? null) !== 1) {
            return $this->fail('manifest_invalid');
        }
        if (!is_string($manifest['skill_id']) || !preg_match(self::UUID, $manifest['skill_id'])) {
            return $this->fail('manifest_invalid');
        }
        if (!is_string($manifest['version_id']) || !preg_match(self::UUID, $manifest['version_id'])) {
            return $this->fail('manifest_invalid');
        }
        if (!is_string($manifest['slug']) || !preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $manifest['slug']) || strlen($manifest['slug']) > 120) {
            return $this->fail('manifest_invalid');
        }
        if (!is_string($manifest['name']) || $manifest['name'] === '' || mb_strlen($manifest['name']) > 120) {
            return $this->fail('manifest_invalid');
        }
        if (isset($manifest['description']) && (!is_string($manifest['description']) || mb_strlen($manifest['description']) > 1000)) {
            return $this->fail('manifest_invalid');
        }
        if (!is_string($manifest['version']) || !preg_match('/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/', $manifest['version'])) {
            return $this->fail('manifest_invalid');
        }
        if (($manifest['entrypoint'] ?? null) !== 'SKILL.md') {
            return $this->fail('manifest_invalid');
        }
        $files = $manifest['files'] ?? null;
        if (!is_array($files) || !array_is_list($files) || count($files) < 2) {
            return $this->fail('manifest_invalid');
        }
        $seen = [];
        foreach ($files as $file) {
            if (!is_string($file) || $file === '' || str_starts_with($file, '/') || str_contains($file, '\\') || str_contains($file, '..')) {
                return $this->fail('package_unsafe');
            }
            if (isset($seen[$file])) {
                return $this->fail('manifest_invalid');
            }
            $seen[$file] = true;
        }
        if (!isset($seen['skill.json']) || !isset($seen['SKILL.md'])) {
            return $this->fail('manifest_invalid');
        }
        $perms = $manifest['permissions'] ?? null;
        if (!is_array($perms)) {
            return $this->fail('manifest_invalid');
        }
        foreach (array_keys($perms) as $key) {
            if (!in_array($key, ['filesystem', 'network', 'commands', 'mcp_servers', 'external_programs'], true)) {
                return $this->fail('manifest_invalid');
            }
        }
        if (!in_array($perms['filesystem'] ?? null, ['none', 'workspace_read', 'workspace_write'], true)) {
            return $this->fail('manifest_invalid');
        }
        $domains = $perms['network']['domains'] ?? null;
        if (!is_array($perms['network'] ?? null) || !is_array($domains) || !array_is_list($domains)) {
            return $this->fail('manifest_invalid');
        }
        foreach ($domains as $domain) {
            if (!is_string($domain) || !preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/', $domain)) {
                return $this->fail('manifest_invalid');
            }
        }
        foreach (['commands', 'mcp_servers', 'external_programs'] as $listKey) {
            $list = $perms[$listKey] ?? null;
            if (!is_array($list) || !array_is_list($list)) {
                return $this->fail('manifest_invalid');
            }
            foreach ($list as $item) {
                if (!is_string($item) || $item === '') {
                    return $this->fail('manifest_invalid');
                }
            }
        }
        if (!is_string($manifest['minimum_client_version']) || !preg_match('/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/', $manifest['minimum_client_version'])) {
            return $this->fail('manifest_invalid');
        }
        return ['ok' => true, 'error' => null, 'manifest' => $manifest];
    }

    /**
     * @return array{ok:bool,error:string,manifest:null}
     */
    private function fail(string $error): array
    {
        return ['ok' => false, 'error' => $error, 'manifest' => null];
    }
}
