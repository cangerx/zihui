<?php

namespace Tests\Unit;

use App\Models\Inspiration;
use App\Models\InspirationCategory;
use App\Services\SharedHub\SharedHubResponse;
use App\Services\SharedHub\SharedHubSyncService;
use App\Services\SharedHub\SharedHubTransport;
use PHPUnit\Framework\TestCase;
use Tests\Support\SharedHubSyncHarness;

class SharedHubSyncServiceTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        SharedHubSyncHarness::boot();
    }

    public function test_pushes_local_approved_and_skips_from_hub(): void
    {
        $cat = InspirationCategory::create(['name' => '海报', 'sort_order' => 0]);
        $local = Inspiration::create([
            'category_id' => $cat->id,
            'title' => '本站海报',
            'cover_image' => 'https://cdn.test/a.png',
            'prompt_cn' => '一只猫',
            'status' => Inspiration::STATUS_APPROVED,
            'is_visible' => true,
        ]);
        Inspiration::create([
            'category_id' => $cat->id,
            'title' => 'Hub 来的',
            'cover_image' => 'https://cdn.test/b.png',
            'prompt_cn' => '不要回推',
            'status' => Inspiration::STATUS_APPROVED,
            'is_visible' => true,
            'from_hub_inspiration_id' => 99,
        ]);

        $insp = new ArrayHubTransport([
            'GET /categories' => new SharedHubResponse(true, 200, [
                'data' => [['id' => 7, 'name' => '海报']],
            ]),
            'POST /submit' => new SharedHubResponse(true, 201, [
                'shared_id' => 55,
                'status' => 'approved',
            ]),
            'GET /list' => new SharedHubResponse(true, 200, ['items' => []]),
        ]);
        $idle = new ArrayHubTransport([]);
        $service = new SharedHubSyncService($insp, $idle, $idle);
        $stats = $service->syncInspirations();

        $this->assertSame(1, $stats['pushed']);
        $this->assertSame(0, $stats['pulled']);
        $this->assertSame(55, (int) $local->fresh()->hub_shared_id);
        $this->assertCount(1, $insp->posted);
        $this->assertSame(7, $insp->posted[0]['hub_category_id']);
    }

    public function test_pulls_hub_item_once(): void
    {
        InspirationCategory::create(['name' => '共享', 'sort_order' => 0]);
        $insp = new ArrayHubTransport([
            'GET /categories' => new SharedHubResponse(true, 200, ['data' => [['id' => 1, 'name' => '共享']]]),
            'GET /list' => new SharedHubResponse(true, 200, [
                'items' => [[
                    'id' => 88,
                    'title' => '跨站灵感',
                    'category_name' => '节日',
                    'cover_image' => 'https://hub.test/c.png',
                    'prompt_cn' => '烟花',
                    'source_site_name' => '邻站',
                ]],
            ]),
        ]);
        $idle = new ArrayHubTransport([]);
        $service = new SharedHubSyncService($insp, $idle, $idle);

        $first = $service->syncInspirations();
        $second = $service->syncInspirations();

        $this->assertSame(1, $first['pulled']);
        $this->assertGreaterThanOrEqual(1, $second['skipped']);
        $this->assertSame(1, Inspiration::where('from_hub_inspiration_id', 88)->count());
        $this->assertTrue(InspirationCategory::where('name', '节日')->exists());
    }
}

class ArrayHubTransport implements SharedHubTransport
{
    /** @var list<array<string, mixed>> */
    public array $posted = [];

    /** @param array<string, SharedHubResponse> $map */
    public function __construct(private array $map)
    {
    }

    public function isReady(): bool
    {
        return true;
    }

    public function get(string $path, array $query = []): SharedHubResponse
    {
        return $this->map['GET ' . $path] ?? new SharedHubResponse(true, 200, ['items' => [], 'data' => []]);
    }

    public function post(string $path, array $body = []): SharedHubResponse
    {
        $this->posted[] = $body;
        return $this->map['POST ' . $path] ?? new SharedHubResponse(false, 500, ['error' => 'unexpected']);
    }
}
