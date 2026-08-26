<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\AppAsset;
use App\Http\Middleware\AuditAppAssetRequest;
use App\Http\Middleware\ValidateAppAssetSignature;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;
use Tymon\JWTAuth\Facades\JWTAuth;

class AppV1AssetTest extends TestCase
{
    use RefreshDatabase;

    private static int $testIpSequence = 1;

    protected function migrateUsing(): array
    {
        return ['--path' => [
            'database/migrations/2024_01_01_000001_create_users_table.php',
            'database/migrations/2026_05_03_000001_create_system_settings_table.php',
            'database/migrations/2026_08_26_000011_create_app_assets_table.php',
            'database/migrations/2026_08_26_000012_create_app_asset_task_leases_table.php',
            'database/migrations/2026_08_26_000014_add_idempotency_hash_to_app_assets.php',
        ], '--seed' => false];
    }

    protected function setUp(): void
    {
        parent::setUp();
        config(['app_v1.features.assets' => true, 'app.url' => 'http://localhost']);
        $octet = 1 + (self::$testIpSequence++ % 250);
        $this->withServerVariables(['REMOTE_ADDR' => "198.51.100.{$octet}"]);
    }

    public function test_assets_are_fail_closed_when_disabled(): void
    {
        config(['app_v1.features.assets' => false]);
        $response = $this->postJson('/api/app/v1/assets/presign', [
            'filename' => 'a.png', 'mime_type' => 'image/png', 'size' => 68,
        ]);
        $response->assertStatus(401)->assertJsonPath('error.code', 'unauthenticated');
    }

    public function test_unauthenticated_asset_request_is_audited(): void
    {
        Log::spy();

        $this->withHeaders(['X-Channel' => 'h5', 'X-Request-Id' => 'asset-audit-anon'])
            ->postJson('/api/app/v1/assets/presign', [
                'filename' => 'anonymous.png', 'mime_type' => 'image/png', 'size' => 68,
            ])->assertStatus(401)->assertJsonPath('error.code', 'unauthenticated');

        Log::shouldHaveReceived('info')->once()->withArgs(function (string $message, array $context) {
            return $message === 'app_v1.asset_request'
                && $context['request_id'] === 'asset-audit-anon'
                && $context['user_id'] === null
                && $context['route'] === 'app.v1.assets.presign'
                && $context['route_template'] === '/api/app/v1/assets/presign'
                && $context['status'] === 401
                && $context['error_code'] === 'unauthenticated';
        });
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

    public function test_presign_fails_closed_without_app_key(): void
    {
        config(['app.key' => null]);
        $user = $this->user();

        $this->withToken(JWTAuth::fromUser($user))->withHeaders(['X-Channel' => 'h5'])
            ->postJson('/api/app/v1/assets/presign', [
                'filename' => 'unsigned.png', 'mime_type' => 'image/png', 'size' => 68,
            ])->assertStatus(503)->assertJsonPath('error.code', 'storage_unavailable');

        $this->assertSame(0, AppAsset::where('user_id', $user->id)->count());
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
        $this->assertSame((string) $user->id, (string) $this->queryParameter($uploadUrl, 'user'));
        $upload = $this->call('PUT', parse_url($uploadUrl, PHP_URL_PATH) . '?' . parse_url($uploadUrl, PHP_URL_QUERY), [], [], [], [
            'HTTP_AUTHORIZATION' => 'Bearer ' . $token,
            'HTTP_X_CHANNEL' => 'h5', 'CONTENT_TYPE' => 'image/png', 'CONTENT_LENGTH' => (string) strlen($bytes),
        ], $bytes);
        $upload->assertOk()->assertJsonPath('data.status', 'uploaded');
        $complete = $this->withToken($token)->withHeaders(['X-Channel' => 'h5'])
            ->postJson("/api/app/v1/assets/{$assetId}/complete")
            ->assertOk()->assertJsonPath('data.status', 'ready');

        $displayUrl = $complete->json('data.display_url');
        $this->assertSame((string) $user->id, (string) $this->queryParameter($displayUrl, 'user'));
        $displayPath = parse_url($displayUrl, PHP_URL_PATH) . '?' . parse_url($displayUrl, PHP_URL_QUERY);
        $this->withToken($token)->withHeaders(['X-Channel' => 'h5'])
            ->get($displayPath)->assertOk()->assertHeader('Content-Type', 'image/png')->assertContent($bytes);

        $other = $this->user();
        $this->withToken(JWTAuth::fromUser($other))->withHeaders(['X-Channel' => 'h5'])
            ->get($displayPath)->assertStatus(404)->assertJsonPath('error.code', 'asset_not_found');

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

    public function test_signed_asset_url_rejects_noncanonical_path(): void
    {
        $assetId = (string) \Illuminate\Support\Str::uuid();
        $canonicalPath = "/api/app/v1/assets/{$assetId}/content";
        $request = Request::create($canonicalPath, 'PUT');
        $route = (new Route('PUT', 'api/app/v1/assets/{id}/content', static fn () => null))
            ->name('app.v1.assets.content.put');
        $route->bind($request);
        $request->setRouteResolver(static fn () => $route);
        $request->server->set('REQUEST_URI', "/api/app/v1/assets/./{$assetId}/content");

        $response = (new ValidateAppAssetSignature())->handle(
            $request,
            static fn () => response('unexpected', 200)
        );

        $this->assertSame(401, $response->getStatusCode());
        $this->assertSame('signature_invalid', $response->getData(true)['error']['code'] ?? null);
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

    public function test_presign_idempotency_key_reuses_pending_asset(): void
    {
        $user = $this->user();
        $token = JWTAuth::fromUser($user);
        $headers = ['X-Channel' => 'h5', 'Idempotency-Key' => 'asset-request-001'];
        $payload = ['filename' => 'first.png', 'mime_type' => 'image/png', 'size' => 68];

        $first = $this->withToken($token)->withHeaders($headers)
            ->postJson('/api/app/v1/assets/presign', $payload)->assertCreated();
        $second = $this->withToken($token)->withHeaders($headers)
            ->postJson('/api/app/v1/assets/presign', $payload)
            ->assertOk();

        $this->assertSame($first->json('data.id'), $second->json('data.id'));
        $this->assertSame($first->json('data.upload_url'), $second->json('data.upload_url'));
        $this->assertSame(1, AppAsset::where('user_id', $user->id)->count());
    }

    public function test_presign_idempotency_key_rejects_a_different_payload(): void
    {
        $user = $this->user();
        $token = JWTAuth::fromUser($user);
        $headers = ['X-Channel' => 'h5', 'Idempotency-Key' => 'asset-request-conflict'];

        $this->withToken($token)->withHeaders($headers)
            ->postJson('/api/app/v1/assets/presign', [
                'filename' => 'first.png', 'mime_type' => 'image/png', 'size' => 68,
            ])->assertCreated();
        $this->withToken($token)->withHeaders($headers)
            ->postJson('/api/app/v1/assets/presign', [
                'filename' => 'different.png', 'mime_type' => 'image/png', 'size' => 68,
            ])->assertStatus(409)->assertJsonPath('error.code', 'idempotency_conflict');

        $this->assertSame(1, AppAsset::where('user_id', $user->id)->count());
    }

    public function test_expired_idempotency_window_allows_a_new_asset(): void
    {
        $user = $this->user();
        $token = JWTAuth::fromUser($user);
        $headers = ['X-Channel' => 'h5', 'Idempotency-Key' => 'asset-request-expired'];

        $first = $this->withToken($token)->withHeaders($headers)
            ->postJson('/api/app/v1/assets/presign', [
                'filename' => 'first.png', 'mime_type' => 'image/png', 'size' => 68,
            ])->assertCreated();
        AppAsset::whereKey($first->json('data.id'))->update([
            'created_at' => now()->subMinutes(11),
            'upload_expires_at' => now()->subMinute(),
        ]);

        $second = $this->withToken($token)->withHeaders($headers)
            ->postJson('/api/app/v1/assets/presign', [
                'filename' => 'second.png', 'mime_type' => 'image/png', 'size' => 68,
            ])->assertCreated();

        $this->assertNotSame($first->json('data.id'), $second->json('data.id'));
        $this->assertNull(AppAsset::find($first->json('data.id'))->idempotency_hash);
    }

    public function test_daily_asset_quota_is_enforced_before_new_presign(): void
    {
        $user = $this->user();
        for ($i = 0; $i < 100; $i++) {
            AppAsset::create([
                'id' => (string) \Illuminate\Support\Str::uuid(),
                'user_id' => $user->id,
                'kind' => 'image',
                'original_name' => "asset-{$i}.png",
                'storage_driver' => 'local',
                'object_key' => "app-assets/{$i}.png",
                'storage_url' => '',
                'declared_mime' => 'image/png',
                'expected_size' => 68,
                'status' => 'failed',
                'expires_at' => now()->addHour(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
        $this->withToken(JWTAuth::fromUser($user))->withHeaders(['X-Channel' => 'h5'])
            ->postJson('/api/app/v1/assets/presign', [
                'filename' => 'blocked.png', 'mime_type' => 'image/png', 'size' => 68,
            ])->assertStatus(429)->assertJsonPath('error.code', 'quota_exceeded');
    }

    public function test_presign_rate_limit_returns_app_v1_error_envelope(): void
    {
        $user = $this->user();
        $token = JWTAuth::fromUser($user);

        for ($i = 0; $i < 30; $i++) {
            $this->withToken($token)->withHeaders(['X-Channel' => 'h5'])
                ->postJson('/api/app/v1/assets/presign', [
                    'filename' => "rate-{$i}.png", 'mime_type' => 'image/png', 'size' => 68,
                ])->assertCreated();
        }

        $this->withToken($token)->withHeaders(['X-Channel' => 'h5'])
            ->postJson('/api/app/v1/assets/presign', [
                'filename' => 'rate-blocked.png', 'mime_type' => 'image/png', 'size' => 68,
            ])->assertStatus(429)->assertJsonPath('error.code', 'rate_limited')
            ->assertJsonStructure(['meta' => ['request_id']]);
    }

    public function test_presign_writes_structured_asset_audit_without_raw_id(): void
    {
        $user = $this->user();
        $token = JWTAuth::fromUser($user);
        Log::spy();

        $response = $this->withToken($token)->withHeaders([
            'X-Channel' => 'h5', 'X-Request-Id' => 'asset-audit-001',
        ])->postJson('/api/app/v1/assets/presign', [
            'filename' => 'audit.png', 'mime_type' => 'image/png', 'size' => 68,
        ])->assertCreated();
        $assetId = (string) $response->json('data.id');

        Log::shouldHaveReceived('info')->once()->withArgs(function (string $message, array $context) use ($user, $assetId) {
            return $message === 'app_v1.asset_request'
                && $context['request_id'] === 'asset-audit-001'
                && $context['user_id'] === (int) $user->id
                && $context['channel'] === 'h5'
                && $context['route'] === 'app.v1.assets.presign'
                && $context['route_template'] === '/api/app/v1/assets/presign'
                && $context['status'] === 201
                && $context['error_code'] === null
                && $context['asset_id_summaries'] === [substr(hash('sha256', $assetId), 0, 12)]
                && !in_array($assetId, $context['asset_id_summaries'], true);
        });
    }

    public function test_image_task_audit_keeps_only_asset_ids_and_caps_summaries(): void
    {
        $submittedAssetIds = array_map(
            static fn () => (string) \Illuminate\Support\Str::uuid(),
            range(1, 6)
        );
        $assetIds = array_slice($submittedAssetIds, 0, 4);
        $taskId = (string) \Illuminate\Support\Str::uuid();
        $request = Request::create('/api/app/v1/image-tasks', 'POST', ['asset_ids' => $submittedAssetIds]);
        $request->headers->set('X-Channel', "h5\nforged-channel-that-must-be-truncated");
        $request->attributes->set('request_id', 'asset-audit-task');
        $route = (new Route('POST', 'api/app/v1/image-tasks', static fn () => null))
            ->name('app.v1.image-tasks.create');
        $route->bind($request);
        $request->setRouteResolver(static fn () => $route);
        Log::spy();

        (new AuditAppAssetRequest())->handle(
            $request,
            static fn () => response()->json(['data' => ['id' => $taskId]], 201)
        );

        Log::shouldHaveReceived('info')->once()->withArgs(function (string $message, array $context) use ($assetIds, $taskId) {
            $expected = array_map(
                static fn (string $id) => substr(hash('sha256', strtolower($id)), 0, 12),
                $assetIds
            );

            return $message === 'app_v1.asset_request'
                && $context['asset_id_summaries'] === $expected
                && !in_array(substr(hash('sha256', strtolower($taskId)), 0, 12), $context['asset_id_summaries'], true)
                && $context['channel'] === 'h5forged-channel-that-must-be-tr'
                && strlen($context['channel']) === 32;
        });
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

    private function queryParameter(string $url, string $name): ?string
    {
        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
        $value = $query[$name] ?? null;

        return is_string($value) ? $value : null;
    }
}
