<?php

namespace Tests\Feature;

use App\Jobs\ProcessImageTaskJob;
use App\Models\CloudModel;
use App\Models\CloudProvider;
use App\Models\ImageTask;
use App\Models\User;
use App\Services\Gateway\GatewayRouter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Mockery;
use Tests\TestCase;
use Tymon\JWTAuth\Facades\JWTAuth;

class AppV1TaskLifecycleTest extends TestCase
{
    use RefreshDatabase;

    protected function migrateUsing(): array
    {
        return [
            '--path' => [
                'database/migrations/2024_01_01_000001_create_users_table.php',
                'database/migrations/2024_01_01_000003_create_cloud_providers_table.php',
                'database/migrations/2024_01_01_000004_create_cloud_models_table.php',
                'database/migrations/2026_04_30_223535_create_image_tasks_table.php',
            ],
            '--seed' => false,
        ];
    }

    protected function setUp(): void
    {
        parent::setUp();
        config(['app_v1.features.image' => true]);
    }

    public function test_lifecycle_endpoints_require_authentication(): void
    {
        $id = (string) Str::uuid();

        $this->getJson('/api/app/v1/tasks')
            ->assertStatus(401)
            ->assertJsonPath('error.code', 'unauthenticated');
        $this->getJson("/api/app/v1/tasks/{$id}")
            ->assertStatus(401)
            ->assertJsonPath('error.code', 'unauthenticated');
        $this->postJson("/api/app/v1/tasks/{$id}/cancel")
            ->assertStatus(401)
            ->assertJsonPath('error.code', 'unauthenticated');
        $this->deleteJson("/api/app/v1/tasks/{$id}")
            ->assertStatus(401)
            ->assertJsonPath('error.code', 'unauthenticated');
    }

    public function test_list_and_show_map_native_statuses_to_the_app_contract(): void
    {
        $owner = $this->user('status-owner');
        $this->task($owner, 'pending');
        $processing = $this->task($owner, 'processing');
        $succeeded = $this->task($owner, 'completed');
        $failed = $this->task($owner, 'failed');
        $cancelled = $this->task($owner, 'cancelled');
        $token = $this->token($owner);

        $this->withToken($token)->getJson('/api/app/v1/tasks?status=queued')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.status', 'queued');

        $this->withToken($token)->getJson('/api/app/v1/tasks?status=processing')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $processing->id)
            ->assertJsonPath('data.0.status', 'processing');

        $this->withToken($token)->getJson('/api/app/v1/tasks?status=succeeded')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $succeeded->id)
            ->assertJsonPath('data.0.status', 'succeeded');

        $this->withToken($token)->getJson('/api/app/v1/tasks?status=failed')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $failed->id)
            ->assertJsonPath('data.0.status', 'failed');

        $this->withToken($token)->getJson('/api/app/v1/tasks?status=cancelled')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $cancelled->id)
            ->assertJsonPath('data.0.status', 'cancelled');

        $this->withToken($token)->getJson("/api/app/v1/tasks/{$succeeded->id}")
            ->assertOk()
            ->assertJsonPath('data.status', 'succeeded');
    }

    public function test_cancel_uses_pending_compare_and_set_and_worker_skips_cancelled_task(): void
    {
        $owner = $this->user('cas-owner');
        $task = $this->task($owner, 'pending');
        $token = $this->token($owner);

        $this->withToken($token)->postJson("/api/app/v1/tasks/{$task->id}/cancel")
            ->assertOk()
            ->assertJsonPath('data.status', 'cancelled');
        $this->assertDatabaseHas('image_tasks', [
            'id' => $task->id,
            'user_id' => $owner->id,
            'status' => 'cancelled',
        ]);

        // ProcessImageTaskJob's claim is also conditional on pending. A cancelled
        // task must never reach the provider, even if its queued job is still run.
        $router = Mockery::mock(GatewayRouter::class);
        $router->shouldReceive('route')->never();
        (new ProcessImageTaskJob($task->id))->handle($router);
        $this->assertSame('cancelled', $task->fresh()->status);
    }

    public function test_worker_claim_winner_is_not_overwritten_by_a_stale_cancel_request(): void
    {
        $owner = $this->user('claim-owner');
        $task = $this->task($owner, 'pending');
        $this->assertSame('pending', $task->fresh()->status);

        // The controller first reads pending. This trigger then models the worker
        // winning immediately before the controller's pending -> cancelled CAS.
        // RAISE(IGNORE) leaves the worker's processing transition in place and
        // makes the cancellation update report zero affected rows.
        DB::unprepared(<<<'SQL'
CREATE TRIGGER simulate_worker_claim_before_cancel
BEFORE UPDATE OF status ON image_tasks
WHEN OLD.status = 'pending' AND NEW.status = 'cancelled'
BEGIN
    UPDATE image_tasks SET status = 'processing' WHERE id = OLD.id;
    SELECT RAISE(IGNORE);
END
SQL);

        try {
            $this->withToken($this->token($owner))
                ->postJson("/api/app/v1/tasks/{$task->id}/cancel")
                ->assertStatus(409)
                ->assertJsonPath('error.code', 'task_not_cancellable');
        } finally {
            DB::unprepared('DROP TRIGGER IF EXISTS simulate_worker_claim_before_cancel');
        }

        $this->assertSame('processing', $task->fresh()->status);
    }

    public function test_processing_task_cannot_be_cancelled_and_terminal_cancel_is_idempotent(): void
    {
        $owner = $this->user('cancel-owner');
        $processing = $this->task($owner, 'processing');
        $token = $this->token($owner);

        $this->withToken($token)->postJson("/api/app/v1/tasks/{$processing->id}/cancel")
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'task_not_cancellable');

        foreach (['completed', 'failed', 'cancelled'] as $status) {
            $task = $this->task($owner, $status);
            $this->withToken($token)->postJson("/api/app/v1/tasks/{$task->id}/cancel")
                ->assertOk()
                ->assertJsonPath('data.status', match ($status) {
                    'completed' => 'succeeded',
                    default => $status,
                });
        }
    }

    public function test_only_terminal_tasks_can_be_deleted(): void
    {
        $owner = $this->user('delete-owner');
        $token = $this->token($owner);

        foreach (['pending', 'processing', 'unexpected'] as $status) {
            $task = $this->task($owner, $status);
            $this->withToken($token)->deleteJson("/api/app/v1/tasks/{$task->id}")
                ->assertStatus(409)
                ->assertJsonPath('error.code', 'task_not_deletable');
            $this->assertDatabaseHas('image_tasks', ['id' => $task->id]);
        }

        foreach (['completed', 'failed', 'cancelled'] as $status) {
            $task = $this->task($owner, $status);
            $this->withToken($token)->deleteJson("/api/app/v1/tasks/{$task->id}")
                ->assertOk()
                ->assertJsonPath('data', null);
            $this->assertDatabaseMissing('image_tasks', ['id' => $task->id]);
        }
    }

    public function test_all_object_endpoints_are_owner_scoped(): void
    {
        $owner = $this->user('scoped-owner');
        $other = $this->user('scoped-other');
        $task = $this->task($owner, 'pending');
        $token = $this->token($other);

        $this->withToken($token)->getJson('/api/app/v1/tasks')
            ->assertOk()
            ->assertJsonPath('data', []);
        $this->withToken($token)->getJson("/api/app/v1/tasks/{$task->id}")
            ->assertStatus(404)
            ->assertJsonPath('error.code', 'not_found');
        $this->withToken($token)->postJson("/api/app/v1/tasks/{$task->id}/cancel")
            ->assertStatus(404)
            ->assertJsonPath('error.code', 'not_found');
        $this->withToken($token)->deleteJson("/api/app/v1/tasks/{$task->id}")
            ->assertStatus(404)
            ->assertJsonPath('error.code', 'not_found');

        $this->assertSame('pending', $task->fresh()->status);
    }

    private function token(User $user): string
    {
        return JWTAuth::fromUser($user);
    }

    private function user(string $prefix): User
    {
        $suffix = bin2hex(random_bytes(4));
        return User::create([
            'username' => "{$prefix}_{$suffix}",
            'email' => "{$prefix}_{$suffix}@example.test",
            'password' => password_hash('password', PASSWORD_BCRYPT),
            'nickname' => $prefix,
            'role' => 'user',
            'status' => 'active',
        ]);
    }

    private function task(User $user, string $status): ImageTask
    {
        $provider = CloudProvider::create([
            'name' => 'Task test provider ' . Str::uuid(),
            'type' => 'openai_compatible',
            'api_base' => 'https://example.test/v1',
            'api_key' => 'test-key',
            'status' => 'active',
        ]);
        $model = CloudModel::create([
            'provider_id' => $provider->id,
            'model_id' => 'task-test-image-' . Str::uuid(),
            'name' => 'Task test image',
            'type' => 'image',
            'status' => 'active',
        ]);

        return ImageTask::create([
            'id' => (string) Str::uuid(),
            'user_id' => $user->id,
            'cloud_model_id' => $model->id,
            'endpoint' => 'generations',
            'request_body' => ['model' => 'task-test-image', 'prompt' => 'test'],
            'status' => $status,
            'request_id' => (string) Str::uuid(),
        ]);
    }
}
