<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\AppAsset;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;
use Tymon\JWTAuth\Facades\JWTAuth;

class AppV1AssetTest extends TestCase
{
    use RefreshDatabase;

    protected function migrateUsing(): array
    {
        return ['--path' => [
            'database/migrations/2024_01_01_000001_create_users_table.php',
            'database/migrations/2026_05_03_000001_create_system_settings_table.php',
            'database/migrations/2026_08_26_000011_create_app_assets_table.php',
            'database/migrations/2026_08_26_000012_create_app_asset_task_leases_table.php',
        ], '--seed' => false];
    }

    protected function setUp(): void
    {
        parent::setUp();
        config(['app_v1.features.assets' => true, 'app.url' => 'http://localhost']);
    }

    public function test_assets_are_fail_closed_when_disabled(): void
    {
        config(['app_v1.features.assets' => false]);
        $response = $this->postJson('/api/app/v1/assets/presign', [
            'filename' => 'a.png', 'mime_type' => 'image/png', 'size' => 68,
        ]);
        $response->assertStatus(401)->assertJsonPath('error.code', 'unauthenticated');
    }

    public function test_authenticated_asset_endpoint_returns_gate_error(): void
    {
        config(['app_v1.features.assets' => false]);
        $user = $this->user();
        $this->withToken(JWTAuth::fromUser($user))->withHeaders(['X-Channel' => 'h5'])
            ->postJson('/api/app/v1/assets/presign', [
                'filename' => 'a.png', 'mime_type' => 'image/png', 'size' => 1,
            ])->assertStatus(503)->assertJsonPath('error.code', 'feature_disabled');
    }

    public function test_signed_upload_and_complete_are_owner_scoped(): void
    {
        $user = $this->user();
        $token = JWTAuth::fromUser($user);
        $bytes = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');
        $this->withToken($token)->withHeaders(['X-Channel' => 'h5'])
            ->postJson('/api/app/v1/assets/presign', [
                'filename' => '../safe.png', 'mime_type' => 'image/png', 'size' => strlen($bytes),
            ])->assertStatus(201)->assertJsonPath('data.status', 'pending');

        $presign = $this->withToken($token)->withHeaders(['X-Channel' => 'h5'])
            ->postJson('/api/app/v1/assets/presign', [
                'filename' => 'safe.png', 'mime_type' => 'image/png', 'size' => strlen($bytes),
            ])->assertStatus(201);
        $assetId = $presign->json('data.id');
        $uploadUrl = $presign->json('data.upload_url');
        $upload = $this->call('PUT', parse_url($uploadUrl, PHP_URL_PATH) . '?' . parse_url($uploadUrl, PHP_URL_QUERY), [], [], [], [
            'HTTP_AUTHORIZATION' => 'Bearer ' . $token,
            'HTTP_X_CHANNEL' => 'h5', 'CONTENT_TYPE' => 'image/png', 'CONTENT_LENGTH' => (string) strlen($bytes),
        ], $bytes);
        $upload->assertOk()->assertJsonPath('data.status', 'uploaded');
        $this->withToken($token)->withHeaders(['X-Channel' => 'h5'])
            ->postJson("/api/app/v1/assets/{$assetId}/complete")
            ->assertOk()->assertJsonPath('data.status', 'ready');
    }

    public function test_upload_url_is_single_use_under_replay(): void
    {
        $user = $this->user();
        $token = JWTAuth::fromUser($user);
        $bytes = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');
        $presign = $this->withToken($token)->withHeaders(['X-Channel' => 'h5'])
            ->postJson('/api/app/v1/assets/presign', [
                'filename' => 'replay.png', 'mime_type' => 'image/png', 'size' => strlen($bytes),
            ])->assertCreated();
        $uploadUrl = $presign->json('data.upload_url');
        $request = function () use ($token, $bytes, $uploadUrl) {
            return $this->call('PUT', parse_url($uploadUrl, PHP_URL_PATH) . '?' . parse_url($uploadUrl, PHP_URL_QUERY), [], [], [], [
                'HTTP_AUTHORIZATION' => 'Bearer ' . $token,
                'HTTP_X_CHANNEL' => 'h5', 'CONTENT_TYPE' => 'image/png', 'CONTENT_LENGTH' => (string) strlen($bytes),
            ], $bytes);
        };
        $request()->assertOk()->assertJsonPath('data.status', 'uploaded');
        $request()->assertStatus(409)->assertJsonPath('error.code', 'upload_consumed');
    }

    public function test_complete_rejects_expired_uploaded_asset(): void
    {
        $user = $this->user();
        $token = JWTAuth::fromUser($user);
        $asset = AppAsset::create([
            'id' => (string) \Illuminate\Support\Str::uuid(),
            'user_id' => $user->id,
            'kind' => 'image',
            'original_name' => 'expired.png',
            'storage_driver' => 'local',
            'object_key' => 'app-assets/expired.png',
            'storage_url' => '',
            'declared_mime' => 'image/png',
            'expected_size' => 68,
            'status' => 'uploaded',
            'expires_at' => now()->subHour(),
            'upload_expires_at' => now()->subHour(),
        ]);

        $this->withToken($token)->withHeaders(['X-Channel' => 'h5'])
            ->postJson("/api/app/v1/assets/{$asset->id}/complete")
            ->assertStatus(404)->assertJsonPath('error.code', 'asset_not_found');
    }

    public function test_purge_skips_active_task_lease_then_deletes_after_release(): void
    {
        $user = $this->user();
        $asset = AppAsset::create([
            'id' => (string) \Illuminate\Support\Str::uuid(),
            'user_id' => $user->id,
            'kind' => 'image',
            'original_name' => 'purge.png',
            'storage_driver' => 'local',
            'object_key' => 'app-assets/purge.png',
            'storage_url' => '',
            'declared_mime' => 'image/png',
            'expected_size' => 68,
            'status' => 'ready',
            'expires_at' => now()->subHour(),
        ]);
        $taskId = (string) \Illuminate\Support\Str::uuid();
        \Illuminate\Support\Facades\DB::table('app_asset_task_leases')->insert([
            'asset_id' => $asset->id,
            'task_id' => $taskId,
            'lease_until' => now()->addHour(),
            'released_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Artisan::call('assets:purge-expired', ['--grace' => 0]);
        $this->assertDatabaseHas('app_assets', ['id' => $asset->id]);

        \Illuminate\Support\Facades\DB::table('app_asset_task_leases')->where('task_id', $taskId)
            ->update(['lease_until' => now()->subMinute(), 'released_at' => null, 'updated_at' => now()]);
        Artisan::call('assets:purge-expired', ['--grace' => 0]);
        $this->assertDatabaseMissing('app_assets', ['id' => $asset->id]);
    }

    private function user(): User
    {
        $suffix = bin2hex(random_bytes(4));
        return User::create([
            'username' => "asset_{$suffix}", 'email' => "{$suffix}@example.test",
            'password' => password_hash('password', PASSWORD_BCRYPT), 'nickname' => 'Asset user',
            'role' => 'user', 'status' => 'active',
        ]);
    }
}
