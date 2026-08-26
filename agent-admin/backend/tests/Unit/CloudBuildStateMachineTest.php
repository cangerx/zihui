<?php

namespace Tests\Unit;

use App\Services\CloudBuild\CloudBuildStateMachine;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class CloudBuildStateMachineTest extends TestCase
{
    private CloudBuildStateMachine $machine;

    protected function setUp(): void
    {
        parent::setUp();
        $this->machine = new CloudBuildStateMachine();
    }

    public function test_legal_happy_path(): void
    {
        $this->assertTrue($this->machine->canTransition('queued', 'building'));
        $this->assertTrue($this->machine->canTransition('building', 'artifact_pending'));
        $this->assertTrue($this->machine->canTransition('artifact_pending', 'ready'));
        $this->assertTrue($this->machine->canTransition('ready', 'delivered'));
        $this->assertTrue($this->machine->canTransition('delivered', 'purged'));
    }

    /**
     * @dataProvider illegalTransitions
     */
    public function test_illegal_transitions_are_rejected(string $from, string $to): void
    {
        $this->assertFalse($this->machine->canTransition($from, $to));
        $this->expectException(InvalidArgumentException::class);
        $this->machine->assertCanTransition($from, $to);
    }

    public function illegalTransitions(): array
    {
        return [
            'skip mirror' => ['queued', 'delivered'],
            'revive failed' => ['failed', 'queued'],
            'revive cancelled' => ['cancelled', 'building'],
            'revive expired' => ['expired', 'ready'],
            'revive purged' => ['purged', 'queued'],
            'unknown phase' => ['not-a-phase', 'queued'],
        ];
    }

    public function test_legacy_cannot_return_to_queue(): void
    {
        $this->assertFalse($this->machine->canTransition('legacy_ready_or_unknown', 'queued'));
        $this->assertTrue($this->machine->canTransition('legacy_ready_or_unknown', 'ready'));
    }
}
