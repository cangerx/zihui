<?php

namespace Tests\Feature;

use App\Models\AppConversation;
use App\Models\CloudModel;
use App\Models\CloudProvider;
use App\Models\ImageTask;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;
use Tymon\JWTAuth\Facades\JWTAuth;

class AppV1OwnershipTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'app_v1.features.chat' => true,
            'app_v1.features.image' => true,
        ]);
    }

    public function test_disabled_chat_returns_versioned_error(): void
    {
        config(['app_v1.features.chat' => false]);
        $user = $this->user();

        $response = $this->withToken($this->token($user))
            ->getJson('/api/app/v1/conversations');

        $response->assertStatus(503)
            ->assertJsonPath('error.code', 'feature_disabled')
            ->assertJsonStructure(['error' => ['code', 'message'], 'meta' => ['request_id']]);
    }

    public function test_conversation_is_scoped_to_authenticated_user(): void
    {
        $owner = $this->user();
        $other = $this->user();
        $conversation = AppConversation::create([
            'user_id' => $owner->id,
            'title' => 'Owner conversation',
            'model' => 'chat-model',
            'pinned' => false,
        ]);

        $response = $this->withToken($this->token($other))
            ->getJson("/api/app/v1/conversations/{$conversation->id}");

        $response->assertStatus(404)->assertJsonPath('error.code', 'not_found');
    }

    public function test_task_list_and_detail_are_scoped_to_authenticated_user(): void
    {
        $owner = $this->user();
        $other = $this->user();
        $task = $this->imageTask($owner);

        $this->withToken($this->token($other))
            ->getJson('/api/app/v1/tasks')
            ->assertOk()
            ->assertJsonPath('data', []);

        $this->withToken($this->token($other))
            ->getJson("/api/app/v1/tasks/{$task->id}")
            ->assertStatus(404)
            ->assertJsonPath('error.code', 'not_found');
    }

    public function test_pending_task_can_be_cancelled_but_processing_task_cannot(): void
    {
        $owner = $this->user();
        $pending = $this->imageTask($owner, 'pending');
        $processing = $this->imageTask($owner, 'processing');
        $token = $this->token($owner);

        $this->withToken($token)
            ->postJson("/api/app/v1/tasks/{$pending->id}/cancel")
            ->assertOk()
            ->assertJsonPath('data.status', 'cancelled');

        $this->assertSame('cancelled', $pending->fresh()->status);

        $this->withToken($token)
            ->postJson("/api/app/v1/tasks/{$processing->id}/cancel")
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'task_not_cancellable');
    }

    private function token(User $user): string
    {
        return JWTAuth::fromUser($user);
    }

    private function user(): User
    {
        $suffix = bin2hex(random_bytes(4));
        return User::create([
            'username' => "test_{$suffix}",
            'email' => "{$suffix}@example.test",
            'password' => password_hash('password', PASSWORD_BCRYPT),
            'nickname' => 'Test user',
            'role' => 'user',
            'status' => 'active',
        ]);
    }

    private function imageTask(User $user, string $status = 'pending'): ImageTask
    {
        $provider = CloudProvider::create([
            'name' => 'Test provider',
            'type' => 'openai_compatible',
            'api_base' => 'https://example.test/v1',
            'api_key' => 'test-key',
            'status' => 'active',
        ]);
        $model = CloudModel::create([
            'provider_id' => $provider->id,
            'model_id' => 'test-image',
            'name' => 'Test image',
            'type' => 'image',
            'status' => 'active',
        ]);

        return ImageTask::create([
            'id' => (string) \Illuminate\Support\Str::uuid(),
            'user_id' => $user->id,
            'cloud_model_id' => $model->id,
            'endpoint' => 'generations',
            'request_body' => ['model' => 'test-image', 'prompt' => 'test'],
            'status' => $status,
            'request_id' => (string) \Illuminate\Support\Str::uuid(),
        ]);
    }
}
