<?php

namespace Tests\Unit;

use App\Models\CloudBuildClient;
use App\Services\CloudBuild\CloudBuildArtifactFetchService;
use App\Services\CloudBuild\CloudBuildArtifactStore;
use App\Services\CloudBuild\CloudBuildCutoverStore;
use App\Services\CloudBuild\CloudBuildEnqueueService;
use App\Services\CloudBuild\CloudBuildExecutionSettings;
use App\Services\CloudBuild\CloudBuildFrontendStatusProjector;
use App\Services\CloudBuild\CloudBuildJobClaimer;
use App\Services\CloudBuild\CloudBuildLocalBackend;
use App\Services\CloudBuild\CloudBuildLocalDeliveryService;
use App\Services\CloudBuild\CloudBuildLocalDispatchService;
use App\Services\CloudBuild\CloudBuildLocalSiteIdentity;
use App\Services\CloudBuild\CloudBuildProjectionSynchronizer;
use App\Services\CloudBuild\PackagingLicense;
use App\Services\CloudBuild\CloudBuildPurgeService;
use App\Services\CloudBuild\CloudBuildQuotaService;
use App\Services\CloudBuild\CloudBuildStateMachine;
use App\Services\CloudBuild\UpdateDirService;
use Tests\Support\CloudBuildExecutionHarness;
use Tests\Support\FakeCloudBuildGitHubGateway;
use PHPUnit\Framework\TestCase;

abstract class CloudBuildExecutionTestCase extends TestCase
{
    protected CloudBuildQuotaService $quota;
    protected CloudBuildJobClaimer $claimer;
    protected CloudBuildExecutionSettings $settings;

    protected function setUp(): void
    {
        parent::setUp();
        CloudBuildExecutionHarness::boot();
        PackagingLicense::fake([
            'can_use_github_packaging' => true,
            'can_use_mac_packaging' => true,
        ]);
        $this->quota = new CloudBuildQuotaService();
        $this->claimer = new CloudBuildJobClaimer(new CloudBuildStateMachine());
        $this->settings = new CloudBuildExecutionSettings();
    }

    protected function tearDown(): void
    {
        PackagingLicense::forget();
        parent::tearDown();
    }

    protected function seedClient(string $ref = 'client-a', int $dailyLimit = 10, string $status = 'active'): CloudBuildClient
    {
        return CloudBuildClient::query()->create([
            'client_ref' => $ref,
            'domain' => 'https://admin.example.test',
            'daily_limit' => $dailyLimit,
            'monthly_limit' => 0,
            'status' => $status,
        ]);
    }

    protected function enqueueService(?CloudBuildExecutionSettings $settings = null, ?CloudBuildCutoverStore $cutover = null): CloudBuildEnqueueService
    {
        return new CloudBuildEnqueueService($this->quota, $settings ?? $this->settings, $cutover);
    }

    /**
     * @param array<string, mixed> $overrides
     * @return array<string, mixed>
     */
    protected function enqueueInput(array $overrides = []): array
    {
        return array_merge([
            'client_ref' => 'client-a',
            'platform' => 'win',
            'app_name' => 'Demo',
            'app_version' => '1.0.0',
            'icon_path' => 'https://admin.example.test/icon.png',
        ], $overrides);
    }

    protected function installProjectionTables(): void
    {
        $schema = \Illuminate\Database\Capsule\Manager::schema();
        if (!$schema->hasTable('cloud_builds')) {
            $schema->create('cloud_builds', function ($table) {
                $table->increments('id');
                $table->string('build_id')->unique();
                $table->string('platform');
                $table->string('app_name');
                $table->string('app_version')->nullable();
                $table->string('icon_path')->nullable();
                $table->string('status')->default('queued');
                $table->string('agent_build_url')->nullable();
                $table->string('filename')->nullable();
                $table->integer('artifact_size')->nullable();
                $table->string('sha256')->nullable();
                $table->text('supplementary_files')->nullable();
                $table->string('stored_path')->nullable();
                $table->string('error_message')->nullable();
                $table->integer('downloaded_bytes')->nullable();
                $table->dateTime('queued_at')->nullable();
                $table->dateTime('started_at')->nullable();
                $table->dateTime('finished_at')->nullable();
                $table->dateTime('downloaded_at')->nullable();
                $table->dateTime('delivered_at')->nullable();
                $table->timestamps();
            });
        }
        if (!$schema->hasTable('oem_builds')) {
            $schema->create('oem_builds', function ($table) {
                $table->increments('id');
                $table->unsignedInteger('oem_project_id')->nullable();
                $table->string('project_key');
                $table->string('build_id')->unique();
                $table->string('platform');
                $table->string('app_name');
                $table->string('app_version')->nullable();
                $table->string('icon_url')->nullable();
                $table->string('app_id')->nullable();
                $table->string('update_path')->nullable();
                $table->string('status')->default('queued');
                $table->string('agent_build_url')->nullable();
                $table->string('filename')->nullable();
                $table->integer('artifact_size')->nullable();
                $table->string('sha256')->nullable();
                $table->text('supplementary_files')->nullable();
                $table->string('stored_path')->nullable();
                $table->string('error_message')->nullable();
                $table->integer('downloaded_bytes')->nullable();
                $table->dateTime('queued_at')->nullable();
                $table->dateTime('started_at')->nullable();
                $table->dateTime('finished_at')->nullable();
                $table->dateTime('downloaded_at')->nullable();
                $table->dateTime('delivered_at')->nullable();
                $table->timestamps();
            });
        }
    }

    protected function localBackend(?FakeCloudBuildGitHubGateway $github = null, ?CloudBuildCutoverStore $cutover = null): CloudBuildLocalBackend
    {
        $github = $github ?? new FakeCloudBuildGitHubGateway();
        $github->configured = false;
        return new CloudBuildLocalBackend(
            $this->enqueueService(null, $cutover),
            new CloudBuildLocalSiteIdentity(),
            $this->quota,
            $this->claimer,
            new CloudBuildFrontendStatusProjector(),
            $github,
            new CloudBuildLocalDispatchService($github, $this->claimer, $this->quota, $this->settings, $cutover),
            new CloudBuildProjectionSynchronizer(new CloudBuildFrontendStatusProjector()),
            $cutover,
        );
    }

    protected function localDelivery(?UpdateDirService $dir = null, ?FakeCloudBuildGitHubGateway $github = null): CloudBuildLocalDeliveryService
    {
        $github = $github ?? new FakeCloudBuildGitHubGateway();
        $github->configured = false;
        $store = new CloudBuildArtifactStore(sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'cb-t44-' . uniqid('', true));
        $fetch = new CloudBuildArtifactFetchService($github, $this->claimer, $this->quota, $store, $this->settings);
        $purge = new CloudBuildPurgeService($this->claimer, $store);
        $dir = $dir ?? $this->createMock(UpdateDirService::class);
        $dispatch = new CloudBuildLocalDispatchService($github, $this->claimer, $this->quota, $this->settings);

        return new CloudBuildLocalDeliveryService(
            $this->enqueueService(),
            new CloudBuildLocalSiteIdentity(),
            new CloudBuildProjectionSynchronizer(new CloudBuildFrontendStatusProjector()),
            new CloudBuildFrontendStatusProjector(),
            $purge,
            $dir,
            $fetch,
            $github,
            $dispatch,
        );
    }
}
