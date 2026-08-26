<?php

namespace Tests\Unit;

use App\Services\SkillRegistry\SkillStateMachine;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class SkillRegistryStateMachineTest extends TestCase
{
    public function test_published_version_cannot_be_replaced(): void
    {
        $m = new SkillStateMachine();
        $this->assertTrue($m->canVersion('published', 'revoked'));
        $this->expectException(InvalidArgumentException::class);
        $m->assertVersion('published', 'uploaded');
    }

    public function test_revoked_cannot_resurrect(): void
    {
        $m = new SkillStateMachine();
        $this->expectException(InvalidArgumentException::class);
        $m->assertVersion('revoked', 'published');
    }
}
