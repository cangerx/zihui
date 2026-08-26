<?php

namespace Tests\Unit;

use App\Models\Inspiration;
use App\Models\InspirationCategory;
use App\Services\SharedHub\DesktopInspirationImportService;
use PHPUnit\Framework\TestCase;
use Tests\Support\SharedHubSyncHarness;

class DesktopInspirationImportServiceTest extends TestCase
{
    private string $file;

    protected function setUp(): void
    {
        parent::setUp();
        SharedHubSyncHarness::boot();
        $this->file = sys_get_temp_dir() . '/desk-insp-' . bin2hex(random_bytes(3)) . '.json';
        file_put_contents($this->file, json_encode([
            [
                'title' => '护照入境章',
                'prompt_cn' => '红色印章',
                'prompt_en' => 'red stamp',
                'category' => '创意',
                'cover_image' => 'https://cdn.test/a.png',
                'ref_image' => 'https://cdn.test/a.png',
            ],
            [
                'title' => '护照入境章',
                'prompt_cn' => '红色印章',
                'prompt_en' => 'dup',
                'category' => '创意',
                'cover_image' => 'https://cdn.test/a.png',
            ],
        ], JSON_UNESCAPED_UNICODE));
    }

    protected function tearDown(): void
    {
        if (is_file($this->file)) {
            unlink($this->file);
        }
        parent::tearDown();
    }

    public function test_imports_unique_rows_once(): void
    {
        $svc = new DesktopInspirationImportService();
        $first = $svc->import($this->file);
        $second = $svc->import($this->file);

        $this->assertSame(1, $first['imported']);
        $this->assertSame(1, $first['skipped']);
        $this->assertSame(0, $second['imported']);
        $this->assertSame(2, $second['skipped']);
        $this->assertSame(1, Inspiration::count());
        $this->assertTrue(InspirationCategory::where('name', '创意')->exists());
        $this->assertSame(Inspiration::STATUS_APPROVED, Inspiration::first()->status);
    }
}
