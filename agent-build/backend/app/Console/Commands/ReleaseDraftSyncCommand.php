<?php

namespace App\Console\Commands;

use App\Services\ReleaseDraft\ChangelogDraftParser;
use App\Services\ReleaseDraft\LocalReleaseDraftStore;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class ReleaseDraftSyncCommand extends Command
{
    protected $signature = 'release-draft:sync
        {--apply-templates : 把桌面模板草稿写入 template_versions 并设为当前}
        {--admin-root= : agent-admin 根目录，默认仓库内 ../agent-admin}
        {--desktop-root= : agent-desktop 根目录，默认仓库内 ../agent-desktop}';

    protected $description = '从本地云控 CHANGELOG / 桌面 package.json 生成授权端发版草稿，供后台表单自动带入';

    public function handle(LocalReleaseDraftStore $store): int
    {
        $repoRoot = dirname(base_path(), 2);
        $adminRoot = $this->option('admin-root') ?: ($repoRoot . DIRECTORY_SEPARATOR . 'agent-admin');
        $desktopRoot = $this->option('desktop-root') ?: ($repoRoot . DIRECTORY_SEPARATOR . 'agent-desktop');

        $admin = $this->syncCloudAdmin($store, $adminRoot);
        $desktop = $this->syncDesktop($store, $desktopRoot);

        if ($this->option('apply-templates')) {
            $desktop = $desktop ?? $store->readDesktopTemplate();
            if ($desktop !== null) {
                $this->applyDesktopTemplate($desktop);
            }
        }

        return self::SUCCESS;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function syncCloudAdmin(LocalReleaseDraftStore $store, string $adminRoot): ?array
    {
        $changelogFile = $adminRoot . '/CHANGELOG.md';
        $versionFile = $adminRoot . '/backend/config/version.php';
        if (!is_file($changelogFile) || !is_file($versionFile)) {
            $this->warn('未找到云控 CHANGELOG 或 version.php，跳过云控草稿：' . $adminRoot);
            return null;
        }
        $version = ChangelogDraftParser::versionFromPhpConfig((string) file_get_contents($versionFile));
        $draft = ChangelogDraftParser::fromMarkdown((string) file_get_contents($changelogFile), $version);
        $draft['generated_at'] = now()->toIso8601String();
        $store->writeCloudAdmin($draft);
        $this->info('云控草稿 ' . $draft['version'] . ' ← ' . $draft['source']);

        return $draft;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function syncDesktop(LocalReleaseDraftStore $store, string $desktopRoot): ?array
    {
        $packageFile = $desktopRoot . '/package.json';
        $changelogFile = $desktopRoot . '/CHANGELOG.md';
        if (!is_file($packageFile) || !is_file($changelogFile)) {
            $this->warn('未找到桌面 package.json 或 CHANGELOG，跳过模板草稿：' . $desktopRoot);
            return null;
        }
        $version = ChangelogDraftParser::versionFromPackageJson((string) file_get_contents($packageFile));
        $draft = ChangelogDraftParser::fromMarkdown((string) file_get_contents($changelogFile), $version);
        $draft['generated_at'] = now()->toIso8601String();
        $store->writeDesktopTemplate($draft);
        $this->info('桌面模板草稿 ' . $draft['version'] . ' ← ' . $draft['source']);

        return $draft;
    }

    /**
     * @param array<string, mixed> $draft
     */
    private function applyDesktopTemplate(array $draft): void
    {
        $version = (string) ($draft['version'] ?? '');
        if (preg_match('/^\\d+\\.\\d+\\.\\d+$/', $version) !== 1) {
            $this->warn('桌面模板版本号无效，跳过写入');
            return;
        }
        $now = now();
        $existing = DB::table('template_versions')->where('version', $version)->first();
        if ($existing === null) {
            $id = DB::table('template_versions')->insertGetId([
                'version' => $version,
                'changelog' => $draft['changelog'] ?? null,
                'released_at' => $now,
                'released_by' => 'draft-sync',
                'is_current' => 0,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        } else {
            $id = (int) $existing->id;
            DB::table('template_versions')->where('id', $id)->update([
                'changelog' => $draft['changelog'] ?? $existing->changelog,
                'updated_at' => $now,
            ]);
        }
        DB::table('template_versions')->where('is_current', 1)->update(['is_current' => 0, 'updated_at' => $now]);
        DB::table('template_versions')->where('id', $id)->update(['is_current' => 1, 'updated_at' => $now]);
        $this->info('已把桌面模板 ' . $version . ' 设为当前');
    }
}
