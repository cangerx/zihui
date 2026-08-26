<?php

namespace Tests\Unit;

use App\Models\CloudBuildTemplate;
use InvalidArgumentException;

class CloudBuildTemplateSetCurrentTest extends CloudBuildExecutionTestCase
{
    public function test_set_current_inserts_and_is_idempotent(): void
    {
        $first = CloudBuildTemplate::setCurrent('1.3.0', '与桌面 package.json 对齐');
        $this->assertSame('1.3.0', $first->version);
        $this->assertTrue((bool) $first->is_current);
        $this->assertSame(1, CloudBuildTemplate::query()->count());

        $again = CloudBuildTemplate::setCurrent('1.3.0');
        $this->assertSame($first->id, $again->id);
        $this->assertSame(1, CloudBuildTemplate::query()->count());
        $this->assertSame(1, CloudBuildTemplate::query()->where('is_current', 1)->count());
        $this->assertSame('与桌面 package.json 对齐', CloudBuildTemplate::query()->value('changelog'));
    }

    public function test_set_current_clears_previous_flag(): void
    {
        CloudBuildTemplate::setCurrent('1.3.0');
        CloudBuildTemplate::setCurrent('1.3.1');
        $this->assertSame(2, CloudBuildTemplate::query()->count());
        $this->assertSame('1.3.1', CloudBuildTemplate::query()->where('is_current', 1)->value('version'));
        $this->assertSame(0, (int) CloudBuildTemplate::query()->where('version', '1.3.0')->value('is_current'));
    }

    public function test_invalid_version_is_rejected(): void
    {
        $this->expectException(InvalidArgumentException::class);
        CloudBuildTemplate::setCurrent('latest');
    }
}
