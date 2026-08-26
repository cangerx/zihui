<?php

namespace Tests\Unit;

use App\Models\CloudBuildJob;
use App\Services\CloudBuild\CloudBuildJobClaimer;
use App\Services\CloudBuild\CloudBuildStateMachine;
use Illuminate\Database\Capsule\Manager as Capsule;
use Illuminate\Database\Schema\Blueprint;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class CloudBuildJobClaimerTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $capsule = new Capsule();
        $capsule->addConnection([
            'driver' => 'sqlite',
            'database' => ':memory:',
            'prefix' => '',
        ]);
        $capsule->setAsGlobal();
        $capsule->bootEloquent();

        $schema = $capsule->schema();
        $schema->dropIfExists('cloud_build_jobs');
        $schema->create('cloud_build_jobs', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('build_id', 36)->unique();
            $table->string('client_ref', 64);
            $table->string('build_mode', 16)->default('normal');
            $table->string('oem_project_key', 64)->nullable();
            $table->string('platform', 8);
            $table->string('app_name', 100)->default('');
            $table->string('app_version', 40)->default('');
            $table->string('phase', 32);
            $table->string('claim_owner', 64)->nullable();
            $table->dateTime('claimed_at')->nullable();
            $table->unsignedTinyInteger('dispatch_attempts')->default(0);
            $table->timestamps();
        });
    }

    public function test_second_worker_cannot_claim_same_job(): void
    {
        $job = CloudBuildJob::query()->create([
            'build_id' => '00000000-0000-4000-8000-000000000001',
            'client_ref' => 'client-a',
            'platform' => 'win',
            'phase' => 'queued',
        ]);

        $claimer = new CloudBuildJobClaimer(new CloudBuildStateMachine());
        $first = $claimer->claim($job->build_id, 'worker-a', 'queued');
        $second = $claimer->claim($job->build_id, 'worker-b', 'queued');

        $this->assertNotNull($first);
        $this->assertSame('worker-a', $first->claim_owner);
        $this->assertNull($second);
        $this->assertSame('worker-a', $job->fresh()->claim_owner);
    }

    public function test_illegal_transition_is_rejected_and_phase_unchanged(): void
    {
        $job = CloudBuildJob::query()->create([
            'build_id' => '00000000-0000-4000-8000-000000000002',
            'client_ref' => 'client-a',
            'platform' => 'mac',
            'phase' => 'failed',
        ]);

        $claimer = new CloudBuildJobClaimer(new CloudBuildStateMachine());
        $this->expectException(InvalidArgumentException::class);
        try {
            $claimer->transition($job, 'queued');
        } finally {
            $this->assertSame('failed', $job->fresh()->phase);
        }
    }

    public function test_same_owner_can_reclaim(): void
    {
        $job = CloudBuildJob::query()->create([
            'build_id' => '00000000-0000-4000-8000-000000000003',
            'client_ref' => 'client-a',
            'platform' => 'win',
            'phase' => 'queued',
        ]);

        $claimer = new CloudBuildJobClaimer(new CloudBuildStateMachine());
        $this->assertNotNull($claimer->claim($job->build_id, 'worker-a', 'queued'));
        $again = $claimer->claim($job->build_id, 'worker-a', 'queued');
        $this->assertNotNull($again);
        $this->assertSame('worker-a', $again->claim_owner);
    }
}
