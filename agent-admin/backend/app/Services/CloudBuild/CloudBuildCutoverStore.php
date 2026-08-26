<?php

namespace App\Services\CloudBuild;

/**
 * 云控打包切换状态。存 JSON 文件，不含凭据。
 * 供 freeze/drain/switch/rollback 命令与运行时闸门共用。
 */
class CloudBuildCutoverStore
{
    public const VERSION = 1;

    public function __construct(private string $path)
    {
    }

    public static function fromConfig(): self
    {
        $path = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'cloud-build-cutover.json';
        try {
            if (function_exists('storage_path')) {
                $path = storage_path('app/cloud-build-cutover.json');
            }
        } catch (\Throwable $e) {
            // 单测/无 Laravel 容器时退回临时目录。
        }

        return new self($path);
    }

    public function path(): string
    {
        return $this->path;
    }

    /**
     * @return array{
     *   version:int,
     *   new_requests_frozen:bool,
     *   workers_paused:bool,
     *   backend_override:?string,
     *   frozen_at:?string,
     *   workers_paused_at:?string,
     *   switched_at:?string,
     *   last_cursor:?string,
     *   last_until:?string,
     *   last_step:string
     * }
     */
    public function read(): array
    {
        $defaults = self::defaults();
        if (!is_file($this->path)) {
            return $defaults;
        }
        $raw = json_decode((string) file_get_contents($this->path), true);
        if (!is_array($raw)) {
            return $defaults;
        }

        return array_merge($defaults, $raw);
    }

    /**
     * @param array<string, mixed> $changes
     * @return array<string, mixed>
     */
    public function patch(array $changes): array
    {
        $state = array_merge($this->read(), $changes);
        $state['version'] = self::VERSION;
        $this->write($state);
        return $state;
    }

    /**
     * @return array<string, mixed>
     */
    public static function defaults(): array
    {
        return [
            'version' => self::VERSION,
            'new_requests_frozen' => false,
            'workers_paused' => false,
            'backend_override' => null,
            'frozen_at' => null,
            'workers_paused_at' => null,
            'switched_at' => null,
            'last_cursor' => null,
            'last_until' => null,
            'last_step' => 'idle',
        ];
    }

    public function newRequestsFrozen(): bool
    {
        return (bool) ($this->read()['new_requests_frozen'] ?? false);
    }

    public function workersPaused(): bool
    {
        return (bool) ($this->read()['workers_paused'] ?? false);
    }

    public function backendOverride(): ?string
    {
        $value = $this->read()['backend_override'] ?? null;
        if ($value === 'local' || $value === 'remote') {
            return $value;
        }
        return null;
    }

    /**
     * @param array<string, mixed> $state
     */
    private function write(array $state): void
    {
        $dir = dirname($this->path);
        if ($dir !== '' && $dir !== '.' && !is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        $json = json_encode($state, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        $tmp = $this->path . '.tmp';
        file_put_contents($tmp, $json . "\n");
        rename($tmp, $this->path);
    }
}
