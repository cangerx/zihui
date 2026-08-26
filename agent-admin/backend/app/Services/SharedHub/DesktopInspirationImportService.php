<?php

namespace App\Services\SharedHub;

use App\Models\Inspiration;
use App\Models\InspirationCategory;

/**
 * 把桌面端自带的 inspirations.json 灌进本站灵感表。只做这一次，不写回桌面。
 */
class DesktopInspirationImportService
{
    public static function defaultFile(): string
    {
        $bundled = base_path('database/data/desktop-inspirations.json');
        if (is_file($bundled)) {
            return $bundled;
        }
        return dirname(base_path(), 2) . '/agent-desktop/resources/inspirations.json';
    }

    /**
     * @return array{imported:int,skipped:int,errors:string[]}
     */
    public function import(string $path): array
    {
        $stats = ['imported' => 0, 'skipped' => 0, 'errors' => []];
        if (!is_file($path) || !is_readable($path)) {
            $stats['errors'][] = 'seed_file_missing';
            return $stats;
        }

        $raw = json_decode((string) file_get_contents($path), true);
        if (!is_array($raw)) {
            $stats['errors'][] = 'seed_file_invalid';
            return $stats;
        }

        $existing = [];
        foreach (Inspiration::query()->get(['title', 'prompt_cn']) as $row) {
            $existing[$this->fingerprint((string) $row->title, (string) $row->prompt_cn)] = true;
        }

        foreach ($raw as $index => $item) {
            if (!is_array($item)) {
                $stats['skipped']++;
                continue;
            }
            $title = mb_substr(trim((string) ($item['title'] ?? '')), 0, 100);
            $promptCn = (string) ($item['prompt_cn'] ?? '');
            $promptEn = (string) ($item['prompt_en'] ?? '');
            if ($title === '' || ($promptCn === '' && $promptEn === '')) {
                $stats['skipped']++;
                $stats['errors'][] = "row#{$index}:missing_title_or_prompt";
                continue;
            }
            $fp = $this->fingerprint($title, $promptCn !== '' ? $promptCn : $promptEn);
            if (isset($existing[$fp])) {
                $stats['skipped']++;
                continue;
            }

            $categoryName = trim((string) ($item['category'] ?? '')) ?: '共享';
            $category = InspirationCategory::firstOrCreate(
                ['name' => mb_substr($categoryName, 0, 50)],
                ['sort_order' => 0]
            );
            $cover = trim((string) ($item['cover_image'] ?? $item['ref_image'] ?? ''));
            $refs = [];
            if (!empty($item['ref_image'])) {
                $refs[] = (string) $item['ref_image'];
            }
            foreach (is_array($item['ref_images'] ?? null) ? $item['ref_images'] : [] as $ref) {
                $ref = trim((string) $ref);
                if ($ref !== '') {
                    $refs[] = $ref;
                }
            }

            Inspiration::create([
                'category_id' => $category->id,
                'title' => $title,
                'cover_image' => $cover,
                'ref_images' => array_values(array_unique($refs)),
                'generation_size' => $item['generation_size'] ?? null,
                'prompt_cn' => $promptCn,
                'prompt_en' => $promptEn,
                'sort_order' => 0,
                'status' => Inspiration::STATUS_APPROVED,
                'is_visible' => true,
            ]);
            $existing[$fp] = true;
            $stats['imported']++;
        }

        return $stats;
    }

    private function fingerprint(string $title, string $prompt): string
    {
        return md5(mb_strtolower(trim($title)) . "\n" . trim($prompt));
    }
}
