<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
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
