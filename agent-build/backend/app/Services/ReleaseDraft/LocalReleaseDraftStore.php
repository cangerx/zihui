<?php

namespace App\Services\ReleaseDraft;

class LocalReleaseDraftStore
{
    public function cloudAdminPath(): string
    {
        return database_path('data/cloud-admin-draft.json');
    }

    public function desktopTemplatePath(): string
    {
        return database_path('data/desktop-template-draft.json');
    }

    /**
     * @return array<string, mixed>|null
     */
    public function readCloudAdmin(): ?array
    {
        return $this->read($this->cloudAdminPath());
    }

    /**
     * @return array<string, mixed>|null
     */
    public function readDesktopTemplate(): ?array
    {
        return $this->read($this->desktopTemplatePath());
    }

    /**
     * @param array<string, mixed> $payload
     */
    public function writeCloudAdmin(array $payload): void
    {
        $this->write($this->cloudAdminPath(), $payload);
    }

    /**
     * @param array<string, mixed> $payload
     */
    public function writeDesktopTemplate(array $payload): void
    {
        $this->write($this->desktopTemplatePath(), $payload);
    }

    /**
     * @return array<string, mixed>|null
     */
    private function read(string $path): ?array
    {
        if (!is_file($path)) {
            return null;
        }
        $data = json_decode((string) file_get_contents($path), true);

        return is_array($data) ? $data : null;
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function write(string $path, array $payload): void
    {
        $dir = dirname($path);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        file_put_contents(
            $path,
            json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . "\n"
        );
    }
}
